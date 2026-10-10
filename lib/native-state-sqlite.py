"""Orbit-owned pinned-engine data snapshotter; no configuration/plugin code import."""
import base64
import hashlib
import json
import os
import pathlib
import sqlite3
import stat
import sys
import tempfile
import time

LIMIT = 8 * 1024 * 1024
engine, mode, root = sys.argv[1:4]
root = pathlib.Path(root).resolve()
if engine not in ("hermes", "opencode") or mode not in ("capture", "restore"):
    raise ValueError("Unsupported state adapter")
paths = ["hermes/state.db", "hermes/memories/MEMORY.md", "hermes/memories/USER.md"] if engine == "hermes" else ["data/opencode/opencode.db"]


def regular(rel):
    current = root
    for component in pathlib.PurePosixPath(rel).parts:
        current = current / component
        try:
            info = current.lstat()
        except FileNotFoundError:
            return None
        if stat.S_ISLNK(info.st_mode):
            raise ValueError("Linked engine state")
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > LIMIT:
        raise ValueError("Unsafe engine state")
    return current


def columns(db, name):
    return {row[1] for row in db.execute('PRAGMA table_info("' + name + '")')}


def database_copy(source, destination):
    # Online backup reads a coherent committed SQLite view including WAL; never copy sidecars.
    # The deadline is independent of the engine writer and fails instead of publishing partial data.
    deadline = time.monotonic() + 5
    for suffix in ("-wal", "-shm"):
        side = pathlib.Path(str(source) + suffix)
        if side.exists() and (side.is_symlink() or not side.is_file() or side.stat().st_nlink != 1):
            raise ValueError("Unsafe database sidecar")
    src = sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=1)
    dst = sqlite3.connect(destination)
    try:
        page_size = src.execute("PRAGMA page_size").fetchone()[0]
        def progress(status, remaining, total):
            if time.monotonic() > deadline or total * page_size > LIMIT:
                raise ValueError("Database snapshot bound")
        src.backup(dst, pages=128, progress=progress, sleep=0.01)
        if dst.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise ValueError("Database integrity failure")
    finally:
        dst.close()
        src.close()


def sanitize(db):
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    cleared = 0
    pending = 0
    sid = None
    if engine == "opencode":
        if not {"session", "message", "part", "todo"}.issubset(tables):
            raise ValueError("Unsupported OpenCode schema")
        if "permission" not in columns(db, "session"):
            raise ValueError("Unsupported permission schema")
        db.execute("UPDATE session SET permission=NULL")
        if "permission" in tables:
            db.execute("DELETE FROM permission")
        if "session_input" in tables:
            if "promoted_seq" not in columns(db, "session_input"):
                raise ValueError("Unsupported native queue schema")
            cleared += db.execute("DELETE FROM session_input WHERE promoted_seq IS NULL").rowcount
        row = db.execute("SELECT id FROM session WHERE parent_id IS NULL AND directory='/workspace' ORDER BY time_created DESC LIMIT 1").fetchone()
        sid = row[0] if row else None
        for row in db.execute("SELECT data FROM part"):
            item = json.loads(row[0])
            if item.get("type") == "tool" and item.get("state", {}).get("status") in ("pending", "running"):
                pending += 1
    else:
        if not {"sessions", "messages"}.issubset(tables):
            raise ValueError("Unsupported Hermes schema")
        cs = columns(db, "sessions")
        if not {"model_config", "source", "started_at"}.issubset(cs):
            raise ValueError("Unsupported Hermes routing schema")
        # Live routing and runtime credentials are regenerated, not inherited from old sessions.
        db.execute("UPDATE sessions SET model_config=NULL")
        if "async_delegations" in tables:
            pending += db.execute("SELECT COUNT(*) FROM async_delegations").fetchone()[0]
        for table in ("gateway_routing", "async_delegations", "compression_locks", "session_turn_leases", "gateway_heartbeats"):
            if table in tables:
                cleared += db.execute('DELETE FROM "' + table + '"').rowcount
        cm = columns(db, "messages")
        if {"active", "display_metadata"}.issubset(cm):
            cleared += db.execute("UPDATE messages SET active=0 WHERE role='user' AND active=1 AND json_valid(display_metadata) AND json_extract(display_metadata,'$._queued_prompt')=1").rowcount
        row = db.execute("SELECT id FROM sessions WHERE source='api_server' ORDER BY started_at DESC LIMIT 1").fetchone()
        sid = row[0] if row else None
        calls, results = set(), set()
        if sid:
            for role, tool_calls, tool_call_id in db.execute("SELECT role,tool_calls,tool_call_id FROM messages WHERE session_id=? AND active=1 ORDER BY id", (sid,)):
                if tool_calls:
                    calls.update(c["id"] for c in json.loads(tool_calls) if isinstance(c, dict) and c.get("id"))
                if role == "tool" and tool_call_id:
                    results.add(tool_call_id)
        pending += len(calls - results)
    db.commit()
    # Deleted queue/grant/routing bytes must not survive in free pages.
    db.execute("VACUUM")
    return {"sessionId": sid, "pendingEffects": pending, "retiredQueueRows": cleared}


if mode == "capture":
    files, total = [], 0
    summary = {"sessionId": None, "pendingEffects": 0, "retiredQueueRows": 0}
    for rel in paths:
        source = regular(rel)
        if source is None:
            continue
        if rel.endswith(".db"):
            with tempfile.TemporaryDirectory() as temp:
                dest = pathlib.Path(temp) / "snapshot.db"
                database_copy(source, dest)
                if rel.endswith("state.db") or engine == "opencode":
                    db = sqlite3.connect(dest)
                    try:
                        summary = sanitize(db)
                    finally:
                        db.close()
                data = dest.read_bytes()
        else:
            data = source.read_bytes()
        total += len(data)
        if total > LIMIT:
            raise ValueError("Engine state exceeds its bound")
        files.append({"path": rel, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "data": base64.b64encode(data).decode("ascii")})
    print(json.dumps({"version": 1, "engine": engine, "adapter": 1, "files": files, **summary}))
else:
    bundle = json.loads(sys.stdin.read(16 * 1024 * 1024 + 1))
    if bundle.get("engine") != engine or bundle.get("adapter") != 1 or bundle.get("pendingEffects") != 0:
        raise ValueError("Unresolved native state")
    total, seen = 0, set()
    for entry in bundle["files"]:
        rel = entry["path"]
        if rel not in paths or rel in seen:
            raise ValueError("Unsupported state path")
        seen.add(rel)
        data = base64.b64decode(entry["data"], validate=True)
        total += len(data)
        if total > LIMIT or len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise ValueError("State integrity failure")
        dest = root / rel
        current = root
        for component in pathlib.PurePosixPath(rel).parts[:-1]:
            current = current / component
            if not current.exists() and not current.is_symlink():
                current.mkdir(mode=0o700)
            if current.is_symlink() or not current.is_dir():
                raise ValueError("Linked restore parent")
        if dest.exists() or dest.is_symlink():
            raise ValueError("Restore destination already exists")
        with dest.open("xb") as handle:
            os.chmod(dest, 0o600)
            handle.write(data)
        if rel.endswith("state.db") or engine == "opencode":
            db = sqlite3.connect(dest)
            try:
                actual = sanitize(db)
                if actual["sessionId"] != bundle["sessionId"] or actual["pendingEffects"]:
                    raise ValueError("Session restore mismatch")
            finally:
                db.close()
    print(json.dumps({"restored": True, "sessionId": bundle["sessionId"], "files": len(seen)}))
