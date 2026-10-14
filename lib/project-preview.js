'use strict';
// Disposable static preview: no project command, installation, live workspace mount or persistent state.
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const { SECRET_NAME, SECRET_DIR } = require('./fsmcp');
const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.mp4':'video/mp4', '.webm':'video/webm', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json' };
const SKIP = new Set(['node_modules','.git','.venv','__pycache__']);
function inside(root, target) { const r=path.relative(root,target); return r===''||(!r.startsWith('..')&&!path.isAbsolute(r)); }
function projectRoot(workspace, input) {
  const base=fs.realpathSync(workspace), lexical=path.resolve(workspace,String(input||''));
  if (!String(input||'').trim() || !inside(path.resolve(workspace),lexical) || lexical===path.resolve(workspace)) throw Error('Choose a static project subfolder inside Orbit workspace.');
  let current=lexical;
  while(current!==path.resolve(workspace)) { if(fs.lstatSync(current).isSymbolicLink())throw Error('Linked preview paths are refused.');current=path.dirname(current); }
  const root=fs.realpathSync(lexical);
  if(!inside(base,root)||root===base||!fs.statSync(root).isDirectory())throw Error('Preview must stay inside the workspace.');
  if(path.relative(base,root).split(path.sep).some(x=>x.startsWith('.')||SECRET_DIR.test(x)))throw Error('Private preview locations are refused.');
  return root;
}
function snapshot(workspace,input) {
  const root=projectRoot(workspace,input), files=new Map();let bytes=0,entries=0;
  function walk(dir) {
    for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
      if(++entries>2000)throw Error('Preview directory inventory exceeds its bound.');
      if(item.name.startsWith('.')||SECRET_NAME.test(item.name)||SECRET_DIR.test(item.name)||SKIP.has(item.name))continue;
      const file=path.join(dir,item.name),stat=fs.lstatSync(file);
      if(stat.isSymbolicLink())throw Error('Linked preview files are refused.');
      if(stat.isDirectory()){walk(file);continue;}
      const ext=path.extname(file).toLowerCase();if(!stat.isFile()||!TYPES[ext])continue;
      if(files.size>=250||stat.size>8*1024*1024||bytes+stat.size>32*1024*1024)throw Error('Static preview exceeds its file or memory bound.');
      const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let data;
      try {const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw Error('Preview file identity changed.');
        const buffer=Buffer.alloc(stat.size+1);let used=0,n;while(used<buffer.length&&(n=fs.readSync(fd,buffer,used,buffer.length-used,null))>0)used+=n;
        if(used!==stat.size)throw Error('Preview file changed size.');data=buffer.subarray(0,used);
      } finally {fs.closeSync(fd);}
      const after=fs.lstatSync(file);
      if(after.isSymbolicLink()||after.dev!==stat.dev||after.ino!==stat.ino||after.size!==data.length||after.mtimeMs!==stat.mtimeMs)throw Error('Project changed while preview was captured.');
      bytes+=data.length;files.set(path.relative(root,file).split(path.sep).join('/'),{data,type:TYPES[ext]});
    }
  }
  walk(root);if(!files.has('index.html'))throw Error('Static preview requires index.html. Framework projects need their approved build workflow.');
  return {root,files,bytes};
}
function create({workspace,lifetimeMs=15*60000}) {
  let active=null,generation=0;
  function stop() { generation++;if(active){clearTimeout(active.timer);active.server.closeAllConnections?.();active.server.close();active=null;} }
  async function start(input) {
    const captured=snapshot(workspace(),input);stop();const mine=generation;
    const prefix='/'+crypto.randomBytes(24).toString('hex')+'/', errors=new Set();let requests=0;
    const server=http.createServer((req,res)=>{
      const refuse=code=>{res.writeHead(code,{'Cache-Control':'no-store'});res.end();};
      const host='127.0.0.1:'+server.address()?.port;
      if(req.headers.host!==host||!['GET','HEAD'].includes(req.method)||req.headers.origin&&req.headers.origin!=='http://'+host)return refuse(403);
      let name;try {const raw=String(req.url||'').split('?')[0];if(!raw.startsWith(prefix))return refuse(404);name=decodeURIComponent(raw.slice(prefix.length))||'index.html';}catch{return refuse(400);}
      if(name.split(/[\\/]/).some(x=>x==='..'||x.startsWith('.'))||name.includes('\\')||name.includes('\0'))return refuse(403);
      const file=captured.files.get(name);requests++;
      if(!file){if(errors.size<20)errors.add(name.slice(0,150));return refuse(404);}
      res.writeHead(200,{'Content-Type':file.type,'Content-Length':file.data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
      res.end(req.method==='HEAD'?undefined:file.data);
    });
    server.requestTimeout=5000;server.headersTimeout=5000;server.maxConnections=16;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    if(mine!==generation){server.close();throw Error('Preview stopped before startup completed.');}
    const timer=setTimeout(stop,lifetimeMs);timer.unref?.();server.unref();active={server,timer};
    return {url:'http://127.0.0.1:'+server.address().port+prefix+'index.html',fileCount:captured.files.size,bytes:captured.bytes,expiresInSeconds:lifetimeMs/1000,diagnostics:()=>({requests,missingAssets:[...errors]})};
  }
  return {start,stop};
}
module.exports={create,projectRoot,snapshot};
