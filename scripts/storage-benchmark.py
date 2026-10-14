"""Disposable 1/5-worker SQLite storage fixture. No model, Docker or production home.
This measures storage primitives, NOT real long-running native-agent workloads.
"""
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import sys

helper = pathlib.Path(__file__).resolve().parents[1]/'lib/storage-sqlite.py'
spec = importlib.util.spec_from_file_location('guardian',helper)
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)


def footprint(root):
    counts = {name:0 for name in ('db','wal','shm','events','checkpoints','knowledge','vector','other')}
    for file in root.rglob('*'):
        if not file.is_file(): continue
        rel = file.relative_to(root).as_posix()
        category = 'wal' if rel.endswith('-wal') else 'shm' if rel.endswith('-shm') else 'checkpoints' if rel.startswith('checkpoints/') else 'db' if rel.endswith('.db') else 'events' if rel.startswith('logs/') else 'knowledge' if rel.startswith('library/') else 'other'
        counts[category] += file.stat().st_size
    return counts


results = []
for workers in (1,5):
    with tempfile.TemporaryDirectory(prefix='orbit-storage-bench-') as temp:
        root = pathlib.Path(temp); writers=[]
        (root/'logs').mkdir(); (root/'checkpoints').mkdir(); (root/'library').mkdir()
        samples=[{'batch':0,'bytes':footprint(root)}]
        for worker in range(workers):
            file=root/f'worker-{worker}.db'; db=sqlite3.connect(file); writers.append((db,file))
            db.execute('PRAGMA journal_mode=WAL'); db.execute('PRAGMA wal_autocheckpoint=0')
            db.executescript('CREATE TABLE session(id TEXT PRIMARY KEY); CREATE TABLE message(id INTEGER PRIMARY KEY,session_id TEXT,data TEXT); CREATE TABLE todo(session_id TEXT,content TEXT,status TEXT,position INTEGER);')
            db.execute('INSERT INTO session VALUES(?)',(f'session-{worker}',))
            db.execute('INSERT INTO todo VALUES(?,?,?,?)',(f'session-{worker}','Preserve pending work','pending',1)); db.commit()
        for batch in range(1,5):
            for worker,(db,file) in enumerate(writers):
                db.executemany('INSERT INTO message(session_id,data) VALUES(?,?)',[(f'session-{worker}',f'fixture {batch}-{n} '+('x'*1200)) for n in range(50)])
                db.commit()
                with (root/'logs/events.jsonl').open('a') as out:
                    out.write(json.dumps({'worker':worker,'batch':batch,'type':'fixture_commit'})+'\n')
                # Existing Library persists passages; no vector index is fabricated.
                with (root/'library/chunks.jsonl').open('a') as out:
                    out.write(json.dumps({'worker':worker,'text':'fixture knowledge '+('y'*900)})+'\n')
            samples.append({'batch':batch,'bytes':footprint(root)})
        for worker,(db,file) in enumerate(writers):
            g.archive(file,root/'checkpoints'/f'worker-{worker}')
        samples.append({'batch':'archive','bytes':footprint(root)})
        for db,file in writers: db.close()
        samples.append({'batch':'writers_closed','bytes':footprint(root)})
        results.append({'workers':workers,'committedMessages':workers*200,'samples':samples})
print(json.dumps({'version':1,'status':'passed','results':results,'scope':'Actual SQLite WAL/SHM and copy-compaction primitives in disposable synthetic workloads. No real agents/providers/native CLI/vector index/Docker/7-day stability proof.'},indent=2))
