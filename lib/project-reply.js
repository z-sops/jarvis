'use strict';
// Typed project-state replies come from durable cards, never model-written tables.
const IDS=/project-[a-f0-9-]{36}/g;
const clean=v=>String(v??'').replace(/[\r\n|<>]/g,' ').slice(0,600);
function reconcile({reply,userText='',recentText='',receipts=[],planner}){
  const mentions=[...String(reply).matchAll(IDS),...String(userText).matchAll(IDS)].map(x=>x[0]);
  const stateClaim=/\b(?:saved|updated|removed|refined|configured)\b|(?:hata|save|update|refine|configure)\s+(?:kar|kiya|ki|diya)/i.test(reply);
  if(!mentions.length&&stateClaim)mentions.push(...[...String(recentText).matchAll(IDS)].map(x=>x[0]));
  const ids=[...new Set([...receipts.map(r=>r.id),...mentions])].slice(0,3);if(!ids.length||!planner)return reply;
  return ids.map(id=>{
    let p;try{p=planner.inspect(id);}catch{return 'Project state could not be verified from the durable card. No saved-state change or readiness is confirmed.';}
    const edits=receipts.filter(r=>r.id===id&&['plan_project','refine_project_brief'].includes(r.name));
    const lines=['Project '+p.id+' — current saved state',edits.length?'Proposal save confirmed by successful tool: '+edits.map(r=>r.name).join(', '):'No proposal edit was confirmed in this turn; the following is the current saved card.', 'Goal: '+clean(p.goal), 'Execution readiness: '+clean(p.executionReadiness.status)+' (not human approval).', '', '| Step | Worker | Review target | Outputs | Declared root | Status |','| --- | --- | --- | --- | --- | --- |'];
    for(const s of p.steps.slice(0,100))lines.push('| '+[s.id,s.recommendedAgent||'unassigned',s.reviewOf||'none',s.expectedOutputs.join(', '),s.projectRoot||'missing',s.status].map(clean).join(' | ')+' |');
    if(p.executionReadiness.blockers.length)lines.push('', 'Blockers:',...p.executionReadiness.blockers.map(x=>'- '+clean(x)));
    for(const s of p.steps.filter(x=>x.rootVerification))lines.push('Git-root evidence for '+clean(s.id)+': '+clean(s.rootVerification.status)+(s.rootVerification.checkedAt?' at '+clean(s.rootVerification.checkedAt):'')+'. Execution must recheck.');
    if(p.business?.unknowns?.length)lines.push('', 'Questions to resolve before execution:',...p.business.unknowns.map(x=>'- '+clean(x)));
    if(p.business?.successCriteria?.length)lines.push('', 'Recorded acceptance criteria:',...p.business.successCriteria.map(x=>'- '+clean(x)));
    lines.push('', 'Source review, accepted-artifact handoff, executed tests and human acceptance are separate evidence. No execution or approval is inferred from this card.');return lines.join('\n');
  }).join('\n\n');
}
module.exports={reconcile};
