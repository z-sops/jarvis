'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const {keyRecord} = require('../lib/windows-key-state');
const {createSecretStorage} = require('../lib/secret-storage');
test('key durability refuses missing, malformed, empty, oversized and linked records without replacing them', t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-key-ready-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'Local State');
 assert.equal(keyRecord(root,true).key,null);
 for(const text of ['invalid', '{}', JSON.stringify({os_crypt:{encrypted_key:''}}), 'x'.repeat(1024*1024+1)]) {
  fs.writeFileSync(file,text);assert.equal(keyRecord(root,true).key,null);assert.equal(fs.readFileSync(file,'utf8'),text);
 }
 fs.unlinkSync(file);fs.writeFileSync(path.join(root,'foreign'),'private');fs.symlinkSync(path.join(root,'foreign'),file);
 assert.equal(keyRecord(root,true).key,null);assert.equal(fs.readFileSync(path.join(root,'foreign'),'utf8'),'private');
});
test('persisted key is flushed without rewriting and changed records have distinct private fingerprints', t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-key-ready-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'Local State'),text=JSON.stringify({os_crypt:{encrypted_key:'SYNTHETIC_A'}});fs.writeFileSync(file,text);
 const before=keyRecord(root),after=keyRecord(root,true);assert.deepEqual(after,before);assert.ok(after.key);assert.equal(fs.readFileSync(file,'utf8'),text);
 fs.writeFileSync(file,JSON.stringify({os_crypt:{encrypted_key:'SYNTHETIC_B'}}));assert.notEqual(keyRecord(root,true).key,before.key);
});
test('Windows protected writes fail before encryption when key durability cannot be confirmed; reads remain available',()=> {
 let encrypted=0,ready=false;const provider={isEncryptionAvailable:()=>true,encryptString:s=>{encrypted++;return Buffer.from(s);},decryptString:b=>b.toString()};
 const storage=createSecretStorage(provider,'win32',{beforeSeal:()=>ready});
 assert.throws(()=>storage.seal({private:'secret'}),/unavailable/);assert.equal(encrypted,0);
 ready=true;const sealed=storage.seal({private:'secret'});assert.equal(encrypted,1);ready=false;assert.deepEqual(storage.open(sealed),{private:'secret'});
 const faulty=createSecretStorage(provider,'win32',{beforeSeal:()=>{throw Error('PRIVATE_PATH');}});assert.throws(()=>faulty.seal({}),e=>!e.message.includes('PRIVATE_PATH'));assert.equal(encrypted,1);
});
