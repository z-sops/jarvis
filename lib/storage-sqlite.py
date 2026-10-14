"""Data-only SQLite archive/inspection. Never prune, checkpoint or replace the source.

Archives are sensitive private copies, NOT executable native recovery inputs. Existing
encrypted native checkpoint adapter remains the sole authority for session restoration.
"""
import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import stat
import sys
import tempfile
import time
from contextlib import closing

PIN = "OpenCode 1.18.35 / 53d1eabb61e21162157817bf677da0a4ad3332e3"


def regular(file):
    file = pathlib.Path(os.path.abspath(file))
    for part in [file, *file.parents]:
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise ValueError("Linked storage path")
    info = file.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError("Storage file is not private regular data")
    return file


def connection(file):
    file = regular(file)
    for suffix in ("-wal", "-shm"):
        side = pathlib.Path(str(file) + suffix)
        if side.exists() or side.is_symlink():
            regular(side)
    db = sqlite3.connect(file.as_uri() + "?mode=ro", uri=True, timeout=0.2)
    db.execute("PRAGMA query_only=ON")
    deadline = time.monotonic()+15
    db.set_progress_handler(lambda: int(time.monotonic()>deadline), 10000)
    return db


def digest(file):
    h = hashlib.sha256()
    with regular(file).open("rb") as handle:
        for block in iter(lambda: handle.read(1024*1024), b""):
            h.update(block)
    return h.hexdigest()


def inspect(db):
    if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
        raise ValueError("SQLite integrity failed")
    if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise ValueError("SQLite relations failed")
    schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall()
    names = {row[1] for row in schema if row[0] == "table"}
    # VACUUM can change implicit ROWIDs. Validate every row and identity, not only
    # counts/TODOs; unknown plugin tables must not silently lose reference identity.
    logical = hashlib.sha256()
    rows = 0
    without_rowids = {row[1] for row in db.execute('PRAGMA table_list') if row[4]}
    for name in sorted(names):
        quoted = '"'+name.replace('"','""')+'"'
        cols = list(db.execute('PRAGMA table_info('+quoted+')'))
        if name in without_rowids:
            keys = sorted((row[5],row[1]) for row in cols if row[5])
            order = ','.join('"'+key.replace('"','""')+'"' for _,key in keys)
            query = 'SELECT * FROM '+quoted+' ORDER BY '+order
        else:
            hidden = next((key for key in ('rowid','_rowid_','oid') if key not in {row[1].lower() for row in cols}), None)
            if hidden is None:
                raise ValueError('Ambiguous row identity')
            query = 'SELECT '+hidden+',* FROM '+quoted+' ORDER BY '+hidden
        logical.update(name.encode())
        for row in db.execute(query):
            rows += 1
            if rows > 1000000:
                raise ValueError('Logical verification row bound')
            for value in row:
                data = value if isinstance(value,bytes) else json.dumps(value,ensure_ascii=True,allow_nan=False).encode()
                if len(data)>8*1024*1024:
                    raise ValueError('Logical verification field bound')
                logical.update((type(value).__name__+':'+str(len(data))+':').encode()); logical.update(data)
    known = {"session", "message", "part", "todo", "session_message", "session_input", "session_context_epoch"}
    native = {"session", "message", "part", "todo"}.issubset(names)
    pending = None
    if native:
        cols = {r[1] for r in db.execute("PRAGMA table_info(todo)")}
        if {"session_id", "content", "status", "position"}.issubset(cols):
            pending = db.execute("SELECT COUNT(*) FROM todo WHERE status IN ('pending','in_progress')").fetchone()[0]
    # Schema-compatible is not an independently authenticated CLI version.
    return {"schemaSha256": hashlib.sha256(json.dumps(schema).encode()).hexdigest(),
            "logicalSha256": logical.hexdigest(),
            "pageSize": db.execute("PRAGMA page_size").fetchone()[0],
            "pageCount": db.execute("PRAGMA page_count").fetchone()[0],
            "freePages": db.execute("PRAGMA freelist_count").fetchone()[0],
            "journalMode": db.execute("PRAGMA journal_mode").fetchone()[0],
            "openCodeShape": native, "pendingTodos": pending,
            "unknownTables": len(names-known-{"project", "permission", "__drizzle_migrations", "sqlite_sequence"}),
            "reference": PIN, "pruneAllowed": False}


def archive(source, destination, *, max_bytes=1024*1024*1024, seconds=15, reserve=64*1024*1024, phase=lambda p: None):
    source = regular(source)
    destination = pathlib.Path(os.path.abspath(destination))
    if destination.exists() or destination.is_symlink():
        raise ValueError("Archive destination already exists")
    parent = destination.parent
    for part in [parent, *parent.parents]:
        if part.is_symlink() or not part.is_dir():
            raise ValueError("Unsafe archive parent")
    deadline = time.monotonic()+seconds
    original = source.stat()
    # Exclusive reservation survives forced termination; stale reservations require inspection.
    lock = parent / ("."+destination.name+".lock")
    handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(handle)
    stage = None
    try:
        stage = pathlib.Path(tempfile.mkdtemp(prefix=".orbit-storage-", dir=parent))
        phase("reserved")
        with closing(connection(source)) as src:
            pages = src.execute("PRAGMA page_count").fetchone()[0]
            size = src.execute("PRAGMA page_size").fetchone()[0]
            required = pages*size
            if required > max_bytes or shutil.disk_usage(parent).free < required*3+reserve:
                raise ValueError("Insufficient bounded archive space")
            copy = stage / "snapshot.db"
            with closing(sqlite3.connect(copy)) as target:
                os.chmod(copy, 0o600)
                target.set_progress_handler(lambda: int(time.monotonic()>deadline), 10000)
                def progress(status, remaining, total):
                    if time.monotonic()>deadline or total*size>max_bytes or shutil.disk_usage(parent).free<reserve:
                        raise ValueError("Archive deadline/space bound")
                src.backup(target, pages=128, progress=progress, sleep=0.01)
                before = inspect(target)
                phase("copied")
                target.execute("PRAGMA journal_mode=DELETE")
                # Reclaims only already-free pages of the COPY, keeps all rows and schema.
                target.execute("VACUUM")
                after = inspect(target)
                if before["schemaSha256"] != after["schemaSha256"] or before["logicalSha256"] != after["logicalSha256"] or before["pendingTodos"] != after["pendingTodos"]:
                    raise ValueError("Archive logical state changed")
            if time.monotonic()>deadline:
                raise ValueError("Archive deadline")
        if source.stat().st_ino != original.st_ino or source.stat().st_dev != original.st_dev:
            raise ValueError("Source identity changed")
        with copy.open("r+b") as file:
            os.fsync(file.fileno())
        manifest = {"version": 1, "bytes": copy.stat().st_size, "sha256": digest(copy),
                    "snapshot": after, "sourceDatabaseNotReplaced": True,
                    "scope": "Coherent SQLite data archive; never replay/import authority, credentials or actions. No source deletion or space reclaim."}
        with (stage/"manifest.json").open("x", encoding="utf8") as file:
            os.chmod(file.name, 0o600)
            file.write(json.dumps(manifest))
            file.flush()
            os.fsync(file.fileno())
        verify(stage)
        phase("verified")
        if destination.exists() or destination.is_symlink():
            raise ValueError("Archive publication conflict")
        os.rename(stage, destination)
        stage = None
        phase("published")
        return manifest
    finally:
        if stage is not None:
            shutil.rmtree(stage)
        lock.unlink()


def verify(folder):
    folder = pathlib.Path(folder)
    raw = regular(folder/"manifest.json")
    if raw.stat().st_size>65536:
        raise ValueError("Archive manifest bound")
    manifest = json.loads(raw.read_text())
    copy = regular(folder/"snapshot.db")
    if manifest.get("version")!=1 or copy.stat().st_size>1024*1024*1024 or copy.stat().st_size!=manifest.get("bytes") or digest(copy)!=manifest.get("sha256"):
        raise ValueError("Archive integrity failed")
    with closing(connection(copy)) as db:
        if inspect(db)!=manifest.get("snapshot"):
            raise ValueError("Archive schema/integrity changed")
    return manifest


if __name__ == "__main__":
    try:
        mode = sys.argv[1]
        if mode == "inspect" and len(sys.argv)==3:
            with closing(connection(sys.argv[2])) as db:
                result = inspect(db)
        elif mode == "archive" and len(sys.argv)==4:
            result = archive(sys.argv[2], sys.argv[3])
        elif mode == "verify" and len(sys.argv)==3:
            result = verify(sys.argv[2])
        else:
            raise ValueError("Invalid arguments")
        print(json.dumps({"status":"passed", "result":result}))
    except Exception:
        print(json.dumps({"status":"blocked", "error":"Storage operation refused; original database preserved. Inspect owned staging/lock after interruption."}))
        sys.exit(1)
