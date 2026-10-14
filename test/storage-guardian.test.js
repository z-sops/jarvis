'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const {measure,growth}=require('../lib/storage-guardian');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-storage-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('storage meter separates WAL/SHM/checkpoints/knowledge/vectors without reading payloads',t=>{
 const root=fixture(t),files={'agents/alex/native/opencode.db':20,'agents/alex/native/opencode.db-wal':30,'agents/alex/native/opencode.db-shm':10,'native-candidates/a/checkpoint.json':40,'library/packs/seo/chunks.jsonl':50,'library/vectors/index.faiss':60,'logs/actions.jsonl':70,'agents/alex/jobs/job-one.json':80};
 for(const [rel,bytes]of Object.entries(files)){const f=path.join(root,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,Buffer.alloc(bytes));}
 const before=measure(root);assert.equal(before.logicalBytes,360);assert.equal(before.totals.wal.bytes,30);assert.equal(before.totals.shm.bytes,10);assert.equal(before.totals.vector.bytes,60);assert.equal(before.totals.knowledge.bytes,50);assert.equal(before.workers.alex.bytes,140);assert.equal(before.coverage.complete,true);assert.ok(!JSON.stringify(before).includes('job-one'));assert.ok(!JSON.stringify(before).includes(root));
 fs.appendFileSync(path.join(root,'logs/actions.jsonl'),'123');assert.equal(growth(before,measure(root)).logicalBytes,3);
});
test('linked/outside data, huge trees and scan errors never report complete coverage',t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'one'),'x');fs.writeFileSync(path.join(root,'two'),'x');assert.equal(measure(root,{maxEntries:1}).coverage.complete,false);
 if(process.platform!=='win32'){fs.symlinkSync(os.tmpdir(),path.join(root,'outside'));assert.equal(measure(root).coverage.skippedLinks,1);assert.throws(()=>measure(path.join(root,'outside')),/real directory/);}
 assert.throws(()=>measure(root,{maxEntries:Infinity}),/bounds/);
});
test('actual SQLite WAL, archive, native fixture restoration and failure gates',()=>{
 const r=cp.spawnSync(process.platform==='win32'?'python':'python',['-B',path.join(__dirname,'storage-sqlite.test.py')],{encoding:'utf8',timeout:45000,maxBuffer:65536});
 assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/Ran 6 tests/);
});
