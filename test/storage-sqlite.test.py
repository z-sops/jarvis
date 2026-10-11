import importlib.util
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HELPER = pathlib.Path(__file__).resolve().parents[1]/'lib/storage-sqlite.py'
spec = importlib.util.spec_from_file_location('guardian', HELPER)
guardian = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guardian)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root/'opencode.db'
        self.db = sqlite3.connect(self.source)
        self.db.executescript('CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,directory TEXT,time_created INTEGER,permission TEXT); CREATE TABLE message(data TEXT); CREATE TABLE part(data TEXT); CREATE TABLE todo(session_id TEXT,content TEXT,status TEXT,position INTEGER); CREATE TABLE session_input(promoted_seq INTEGER);')
        self.db.execute("INSERT INTO session VALUES('native-session',NULL,'/workspace',1,NULL)")
        self.db.execute("INSERT INTO todo VALUES('native-session','Pending work','pending',1)")
        self.db.execute("INSERT INTO message VALUES(?)", ('prior-context-marker',))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_wal_archive_committed_history_todo_and_fresh_process(self):
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute("INSERT INTO message VALUES('committed-WAL-marker')")
        self.db.commit()
        self.db.execute("INSERT INTO message VALUES('uncommitted-marker')")
        before = guardian.digest(self.source)
        archive = self.root/'archive'
        manifest = guardian.archive(self.source, archive)
        self.assertEqual(manifest['snapshot']['pendingTodos'], 1)
        self.assertEqual(guardian.digest(self.source), before)
        copy = sqlite3.connect(archive/'snapshot.db')
        self.assertEqual(copy.execute('SELECT data FROM message').fetchall(), [('prior-context-marker',), ('committed-WAL-marker',)])
        self.assertEqual(copy.execute('SELECT * FROM todo').fetchall(), [('native-session','Pending work','pending',1)])
        copy.close()
        result = subprocess.run([sys.executable,str(HELPER),'verify',str(archive)], capture_output=True, text=True)
        self.assertEqual(result.returncode,0)
        self.assertEqual(json.loads(result.stdout)['status'],'passed')
        self.db.rollback()
        # Existing native sanitizer/restorer accepts this archived coherent DB as test-only input.
        native = HELPER.with_name('native-state-sqlite.py')
        home = self.root/'native'; (home/'data/opencode').mkdir(parents=True)
        (home/'data/opencode/opencode.db').write_bytes((archive/'snapshot.db').read_bytes())
        bundle = subprocess.check_output([sys.executable,str(native),'opencode','capture',str(home)])
        dest = self.root/'restore'; dest.mkdir()
        result = subprocess.run([sys.executable,str(native),'opencode','restore',str(dest)],input=bundle,capture_output=True)
        self.assertEqual(result.returncode,0)
        self.assertEqual(json.loads(result.stdout)['sessionId'],'native-session')
        restored = sqlite3.connect(dest/'data/opencode/opencode.db')
        self.assertEqual(restored.execute('SELECT data FROM message').fetchall(), [('prior-context-marker',), ('committed-WAL-marker',)])
        self.assertEqual(restored.execute('SELECT content,status FROM todo').fetchall(), [('Pending work','pending')])
        restored.close()

    def test_compacts_free_pages_only(self):
        self.db.execute('CREATE TABLE disposable_fixture(data BLOB)')
        self.db.executemany('INSERT INTO disposable_fixture VALUES(?)', [(b'x'*8192,)]*80)
        self.db.commit(); self.db.execute('DELETE FROM disposable_fixture'); self.db.commit()
        size=self.source.stat().st_size
        manifest=guardian.archive(self.source,self.root/'archive')
        self.assertLess(manifest['bytes'],size)
        self.assertEqual(self.source.stat().st_size,size)
        self.assertEqual(manifest['snapshot']['pendingTodos'],1)
        # Unknown plugin references may rely on implicit ROWIDs. A VACUUM which
        # renumbers them must never publish a supposedly equivalent archive.
        self.db.execute('CREATE TABLE plugin_refs(data TEXT)')
        self.db.execute("INSERT INTO plugin_refs(rowid,data) VALUES(1,'one')")
        self.db.execute("INSERT INTO plugin_refs(rowid,data) VALUES(3,'three')")
        self.db.commit()
        before = guardian.digest(self.source)
        with self.assertRaisesRegex(ValueError,'logical state'):
            guardian.archive(self.source,self.root/'rowid-change')
        self.assertFalse((self.root/'rowid-change').exists())
        self.assertEqual(guardian.digest(self.source),before)

    def test_low_space_and_locked_source_preserved(self):
        before=guardian.digest(self.source)
        with self.assertRaises(ValueError):
            guardian.archive(self.source,self.root/'low',reserve=10**18)
        self.assertFalse((self.root/'low').exists())
        self.db.execute('BEGIN EXCLUSIVE')
        with self.assertRaises(sqlite3.OperationalError):
            guardian.archive(self.source,self.root/'locked',seconds=0.3)
        self.db.rollback()
        self.assertEqual(guardian.digest(self.source),before)
        self.assertFalse((self.root/'locked').exists())

    def test_corrupt_archive_and_source_are_blocked(self):
        archive=self.root/'archive'; guardian.archive(self.source,archive)
        with (archive/'snapshot.db').open('r+b') as file:
            file.write(b'CORRUPT')
        result=subprocess.run([sys.executable,str(HELPER),'verify',str(archive)],capture_output=True,text=True)
        self.assertEqual(result.returncode,1)
        self.assertNotIn('Pending work',result.stdout+result.stderr)
        bad=self.root/'bad.db'; bad.write_bytes(b'not a database')
        with self.assertRaises(sqlite3.DatabaseError):
            guardian.archive(bad,self.root/'bad-archive')
        self.assertEqual(bad.read_bytes(),b'not a database')

    def test_owned_forced_termination_before_publication_preserves_source(self):
        before=guardian.digest(self.source)
        for phase in ('reserved','copied','verified'):
            dest=self.root/phase
            code="""import importlib.util,sys,time
s=importlib.util.spec_from_file_location('g',sys.argv[1]);g=importlib.util.module_from_spec(s);s.loader.exec_module(g)
def phase(p):
 if p==sys.argv[4]:
  print('READY',flush=True)
  time.sleep(30)
g.archive(sys.argv[2],sys.argv[3],phase=phase)
"""
            proc=subprocess.Popen([sys.executable,'-u','-c',code,str(HELPER),str(self.source),str(dest),phase],stdout=subprocess.PIPE,text=True)
            self.assertEqual(proc.stdout.readline().strip(),'READY')
            proc.kill(); proc.wait(timeout=5); proc.stdout.close()
            self.assertFalse(dest.exists())
            self.assertEqual(guardian.digest(self.source),before)
            # A stale reservation never auto-replays cleanup, even in a fresh process.
            result=subprocess.run([sys.executable,str(HELPER),'archive',str(self.source),str(dest)],capture_output=True,text=True)
            self.assertEqual(result.returncode,1)
        self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchone(),('ok',))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM todo').fetchone()[0],1)

    def test_existing_destination_and_links_refused(self):
        dest=self.root/'exists'; dest.mkdir(); (dest/'keep').write_text('keep')
        with self.assertRaises(ValueError): guardian.archive(self.source,dest)
        self.assertEqual((dest/'keep').read_text(),'keep')
        if os.name!='nt':
            linked=self.root/'linked.db'; linked.symlink_to(self.source)
            with self.assertRaises(ValueError): guardian.archive(linked,self.root/'link-archive')


if __name__=='__main__':
    unittest.main()
