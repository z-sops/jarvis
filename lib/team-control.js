'use strict';
// Trusted UI over existing project records; polling observes, never schedules/replays work.
const fs=require('fs'),crypto=require('crypto');
function createControl({home,planner,now=Date.now}){
 const previews=new Map();
 const list=()=>{const dir=home.p('projects');if(!fs.existsSync(dir))return {projects:[]};const st=fs.lstatSync(dir);if(st.isSymbolicLink()||!st.isDirectory())throw Error('Unsafe project inventory.');const names=fs.readdirSync(dir);if(names.length>200)throw Error('Project inventory exceeds bounded UI capacity.');return {projects:names.filter(n=>/^project-[a-f0-9-]{36}\.json$/.test(n)).map(n=>{const p=planner.inspect(n.slice(0,-5));return {id:p.id,goal:p.goal};})};};
 const inspect=id=>({team:planner.teamState(id),plan:planner.inspect(id)});
 function preview(id,revision,limit){const view=planner.teamState(id);if(view.revision!==revision)throw Error('Team state changed. Inspect again.');require('./team-budget').policy(limit);for(const [k,v] of previews)if(now()>v.expires)previews.delete(k);if(previews.size>=10)throw Error('Cancel old budget previews first.');const p={token:crypto.randomUUID(),id,revision,limit:structuredClone(limit),expires:now()+300000};previews.set(p.token,p);return p;}
 function apply(token){const p=previews.get(token);previews.delete(token);if(!p||now()>p.expires)throw Error('Budget preview expired or cancelled.');return {team:planner.setTeamBudget(p.id,p.revision,p.limit)};}
 return {list,inspect,preview,apply,cancel:t=>({cancelled:previews.delete(t)}),draft:(id,provider,question,ids)=>planner.prepareDiscussion(id,provider,question,ids),reply:(id,did,hash,text)=>planner.recordDiscussion(id,did,hash,text)};
}
function register({ipcMain,isTrusted,...opts}){const c=createControl(opts);for(const [name,fn] of Object.entries(c))ipcMain.handle('teams:'+name,async(e,...a)=>{if(!isTrusted(e))return {ok:false,error:'Trusted application frame required.'};try{return {ok:true,...fn(...a)};}catch(err){return {ok:false,error:err.message};}});return c;}
module.exports={createControl,register};
