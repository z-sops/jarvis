'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {runtimePath}=require('../lib/native-runtime-path');
test('packaged Docker runtime resolves only the real unpacked helper and refuses a missing file',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-beta-package-'));
  try{
    const dir=path.join(root,'resources','app.asar','lib'),physical=path.join(root,'resources','app.asar.unpacked','lib');
    assert.throws(()=>runtimePath(dir));fs.mkdirSync(physical,{recursive:true});fs.writeFileSync(path.join(physical,'native-container-runner.js'),'fixture');
    assert.equal(runtimePath(dir),path.join(physical,'native-container-runner.js'));
    assert.equal(runtimePath(path.join(__dirname,'../lib')),path.join(__dirname,'../lib/native-container-runner.js'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('beta manifest keeps app identity, recovery data and explicit no-publish build checks',()=>{
  const p=require('../package.json'),lock=require('../package-lock.json');assert.equal(p.version,'0.1.0-beta.1');assert.equal(lock.version,p.version);assert.equal(lock.packages[''].version,p.version);
  assert.equal(p.build.appId,'com.zunitech.orbit');assert.equal(p.build.nsis.deleteAppDataOnUninstall,false);assert.equal(p.build.nsis.runAfterFinish,false);
  assert(p.build.asarUnpack.includes('lib/native-container-runner.js'));assert.match(p.scripts.dist,/--publish never/);assert.match(p.scripts.dist,/check-release.js --dist/);
});
test('actual ASAR verification requires matching unpacked runtime bytes and runtime dependency entries',async()=>{
  const asar=require('@electron/asar'),cp=require('child_process'),root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-beta-asar-'));
  try{
    for(const dir of ['scripts','assets','lib','renderer/js','renderer/fonts','dist/win-unpacked/resources'])fs.mkdirSync(path.join(root,dir),{recursive:true});
    fs.copyFileSync(path.join(__dirname,'../scripts/check-release.js'),path.join(root,'scripts/check-release.js'));
    fs.copyFileSync(path.join(__dirname,'../assets/icon.png'),path.join(root,'assets/icon.png'));
    fs.copyFileSync(path.join(__dirname,'../lib/native-container-runner.js'),path.join(root,'lib/native-container-runner.js'));
    fs.writeFileSync(path.join(root,'main.js'),"require('electron');");
    fs.writeFileSync(path.join(root,'renderer/js/probe.js'),'window.packageProbe=true;');
    fs.writeFileSync(path.join(root,'renderer/fonts/probe.woff2'),Buffer.from([0,1,2,3,255]));
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({build:{files:['main.js','lib/**','renderer/**','assets/**','package.json'],win:{icon:'assets/icon.png'}}}));
    const stage=path.join(root,'stage');fs.mkdirSync(stage);
    for(const p of ['main.js','lib','renderer','assets','package.json'])fs.cpSync(path.join(root,p),path.join(stage,p),{recursive:true});
    const metadata=JSON.parse(fs.readFileSync(path.join(stage,'package.json')));delete metadata.build;
    fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(metadata,null,2));
    const required=['@modelcontextprotocol/sdk/package.json','js-yaml/package.json','pdfjs-dist/legacy/build/pdf.mjs'];
    // Fixture entries copy actual installed bytes; no Windows binary or runtime proof.
    for(const p of required){const dest=path.join(stage,'node_modules',p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(__dirname,'../node_modules',p),dest);}
    const file=path.join(root,'dist/win-unpacked/resources/app.asar');
    await require('node:stream/promises').finished(await asar.createPackageWithOptions(stage,file,{unpack:'**/native-container-runner.js'}));
    const run=()=>cp.spawnSync(process.execPath,[path.join(root,'scripts/check-release.js'),'--dist'],{env:{...process.env,NODE_PATH:path.join(__dirname,'../node_modules')},encoding:'utf8'});
    let result=run();assert.equal(result.status,0,result.stdout+result.stderr);
    fs.appendFileSync(file+'.unpacked/lib/native-container-runner.js','\nchanged');result=run();assert.equal(result.status,1);assert.match(result.stdout,/built file missing or differs from source/);
    fs.rmSync(path.join(stage,'node_modules/js-yaml'),{recursive:true,force:true});
    await require('node:stream/promises').finished(await asar.createPackageWithOptions(stage,file,{unpack:'**/native-container-runner.js'}));result=run();assert.equal(result.status,1);assert.match(result.stdout,/required runtime dependency absent/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('installed ASAR Windows directory traversal requires normalized nested paths',()=>{
  const vm=require('vm'),moduleApi=require('module');
  const filename=require.resolve('@electron/asar/lib/filesystem.js');
  const localRequire=moduleApi.createRequire(filename),exports={};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{exports,require:n=>n==='path'?path.win32:localRequire(n),process,Buffer});
  const {Filesystem}=exports;
  const header=()=>({files:{renderer:{files:{js:{files:{'probe.js':{size:7,offset:'0'}}}}}}});
  const original=new Filesystem('C:\\fixture');original.setHeader(header(),0);
  assert.throws(()=>original.getFile('renderer/js/probe.js'),/not found/);
  const normalized=new Filesystem('C:\\fixture');normalized.setHeader(header(),0);
  assert.equal(normalized.getFile(path.win32.normalize('renderer/js/probe.js')).size,7);
  assert.match(fs.readFileSync(path.join(__dirname,'../scripts/check-release.js'),'utf8'),/archiveName=path.normalize\(name\)/);
});
