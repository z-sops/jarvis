'use strict';
// The leads/CRM as tools behind the gateway. Unlike the library (scoped per crew member), leads are shared company
// data: every crew member and Laila see the same pipeline, since finding, pitching and delivering to a lead is
// usually a team effort. Nothing here sends anything or touches an outside service; it only reads and writes the
// local pipeline. A do-not-contact lead is never hidden -- only marked, and the marking is repeated in every reply.
const { Leads, STATUSES } = require('./leads');

const day = iso => String(iso || '').slice(0, 10);
const line = l => `${l.id}  ${l.name}${l.city ? ' (' + l.city + ')' : ''} \u00B7 ${l.status}${l.doNotContact ? ' \u00B7 DO NOT CONTACT' : ''}${l.assignedTo ? ' \u00B7 ' + l.assignedTo : ''}`;
function full(l) {
  const out = [line(l)]; for (const [k, v] of [['website', l.website], ['phone', l.phone], ['email', l.email], ['industry', l.industry], ['source', l.source], ['tags', (l.tags || []).join(', ')]]) if (v) out.push(`  ${k}: ${v}`);
  out.push(`  added ${day(l.createdAt)} \u00B7 last contacted ${l.lastContactedAt ? day(l.lastContactedAt) : 'never'}`);
  if (l.notes.length) { out.push('  notes:'); for (const n of l.notes.slice(-10)) out.push(`    ${day(n.t)}: ${n.text}`); }
  return out.join('\n');
}

class LeadsProvider {
  constructor({ home, leads } = {}) { this.leads = leads || new Leads(home); this.lastUse = Date.now(); this.sig = 'leads'; this.url = 'orbit://leads'; this.token = ''; }
  abort() {} async close() {} get connected() { return true; }
  async listTools() {
    const RO = { readOnlyHint: true, openWorldHint: false }, S = d => ({ type: 'string', description: d });
    return [
      { name: 'lead_add', description: 'Add a new lead (a business that might become a client). Only a name is required. Starts at status "new". This does not contact anyone.', inputSchema: { type: 'object', properties: { name: S('Business name'), website: S('optional'), phone: S('optional'), email: S('optional, only if the business made it public'), city: S('optional'), industry: S('optional'), source: S('how it was found, e.g. "places", "referral"'), tags: { type: 'array', items: { type: 'string' } }, notes: S('an opening note, optional') }, required: ['name'] }, annotations: {} },
      { name: 'lead_list', description: `List leads, newest-updated first. Filter by status (${STATUSES.join(', ')}), who it is assigned to, or a tag.`, inputSchema: { type: 'object', properties: { status: S('optional'), assigned_to: S('optional, a crew member id'), tag: S('optional'), limit: { type: 'number', description: 'default 20, at most 100' } } }, annotations: RO },
      { name: 'lead_get', description: 'Full detail of one lead: contact info, tags, and its recent notes.', inputSchema: { type: 'object', properties: { id: S('the lead id from lead_list or lead_search') }, required: ['id'] }, annotations: RO },
      { name: 'lead_search', description: 'Search leads by name, city, industry, tag, or anything in their notes.', inputSchema: { type: 'object', properties: { query: S('keywords'), limit: { type: 'number', description: 'default 10, at most 30' } }, required: ['query'] }, annotations: RO },
      { name: 'lead_update', description: `Change a lead: status (${STATUSES.join(', ')}), who it is assigned to, or its contact details. To mark it should never be contacted, set do_not_contact true -- this never removes the lead, only marks it, and it always shows in lead_get and lead_list.`, inputSchema: { type: 'object', properties: { id: S('required'), status: S('optional'), assigned_to: S('optional, empty string to unassign'), do_not_contact: { type: 'boolean' }, website: S('optional'), phone: S('optional'), email: S('optional'), city: S('optional'), industry: S('optional'), tags: { type: 'array', items: { type: 'string' } } }, required: ['id'] }, annotations: {} },
      { name: 'lead_note', description: 'Add a timestamped note to a lead (a call result, what was said, a next step). This is the audit trail: note what happened, do not just change the status.', inputSchema: { type: 'object', properties: { id: S('required'), text: S('required') }, required: ['id', 'text'] }, annotations: {} },
    ];
  }
  async callTool(name, a = {}, ctx = {}) {
    this.lastUse = Date.now(); const ok = text => ({ content: [{ type: 'text', text }], isError: false }), bad = text => ({ content: [{ type: 'text', text }], isError: true });
    try {
      if (name === 'lead_add') { const l = this.leads.add(a); return ok(`Added.\n${full(l)}`); }
      if (name === 'lead_list') { const rows = this.leads.list({ status: a.status || undefined, assignedTo: a.assigned_to || undefined, tag: a.tag || undefined, limit: Math.max(1, Math.min(100, +a.limit || 20)) }); return ok(rows.length ? rows.map(line).join('\n') : 'No leads match that.'); }
      if (name === 'lead_get') { const l = this.leads.get(String(a.id || '')); return l ? ok(full(l)) : bad('No such lead.'); }
      if (name === 'lead_search') { const q = String(a.query || '').trim(); if (!q) return bad('Say what to search for.'); const rows = this.leads.search(q, { limit: Math.max(1, Math.min(30, +a.limit || 10)) }); return ok(rows.length ? rows.map(line).join('\n') : `Nothing found for "${q}".`); }
      if (name === 'lead_update') { const patch = {}; for (const k of ['status', 'website', 'phone', 'email', 'city', 'industry']) if (a[k] != null) patch[k] = a[k]; if (a.assigned_to !== undefined) patch.assignedTo = a.assigned_to || null; if (a.do_not_contact != null) patch.doNotContact = a.do_not_contact; if (a.tags != null) patch.tags = a.tags; const l = this.leads.update(String(a.id || ''), patch); return ok(`Updated.\n${full(l)}`); }
      if (name === 'lead_note') { const l = this.leads.addNote(String(a.id || ''), String(a.text || '')); return ok(`Noted.\n${full(l)}`); }
      return bad(`Unknown tool ${name}.`);
    } catch (e) { return bad(String((e && e.message) || e).slice(0, 300)); }
  }
}

module.exports = { LeadsProvider };
