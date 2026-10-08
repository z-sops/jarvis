'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const O = require(path.join(__dirname, '..', 'renderer', 'js', 'office-core.js'));

const walk = (o, seconds, t0 = 0, rand) => { let t = t0; for (let i = 0; i < seconds * 30; i++) { t += 1 / 30; O.step(o, t, 1 / 30, rand); } return t; };
const at = (o, p, tol = 0.6) => Math.hypot(o.x - p[0], o.y - p[1]) < tol;
const agent = (extra = {}) => ({ x: 130, y: 72, state: 'idle', station: 0, ...extra });

test('rooms: every spot and every desk lies inside the room it belongs to, and every door is on the hallway side', () => {
  for (const [room, list] of Object.entries(O.SPOTS)) for (const p of list) assert.equal(O.roomAt(p[0], p[1]), room, `${room} spot ${p}`);
  for (let i = 0; i < 12; i++) { assert.equal(O.roomAt(...O.seat(i)), 'desks', 'seat ' + i); assert.equal(O.roomAt(...O.deskCenter(i)), 'desks', 'desk ' + i); }
  for (const [id, r] of Object.entries(O.ROOMS)) { const d = O.doorPoint(r); assert.ok(d[0] > r.x && d[0] < r.x + r.w, id + ' door is inside the wall'); assert.ok(Math.abs(d[1] - O.HALL_Y) < 9, id + ' door touches the hallway'); }
  assert.equal(O.roomAt(80, 45), 'hall');
});

test('route: through the door, along the hallway, in by the other door (never through a wall)', () => {
  const r = O.route([130, 72], O.seat(0)); // lounge -> desks
  assert.deepEqual(r[0], O.doorPoint(O.ROOMS.lounge)); assert.deepEqual(r[r.length - 1], O.seat(0)); assert.ok(r.some(p => p[1] === O.HALL_Y), 'goes along the hallway');
  const top = O.route([25, 15], O.spot('archive', 0)); assert.deepEqual(top.slice(0, 2), [O.doorPoint(O.ROOMS.command), [25, 45]]); assert.deepEqual(top[top.length - 1], O.spot('archive', 0));
  assert.deepEqual(O.route([20, 60], [90, 65]), [[90, 65]], 'inside one room: a straight line');
  const fromHall = O.route([80, 45], O.spot('comms', 1)); assert.deepEqual(fromHall[0], [O.ROOMS.comms.door, 45]); assert.deepEqual(O.route([80, 44], [80, 45]).at(-1), [80, 45]);
  // every waypoint list goes room-by-room: consecutive points are either on the hallway line, on a door column, or inside one room
  for (const [a, b] of [[[25, 15], [140, 33]], [[140, 33], [25, 15]], [[20, 60], [130, 75]], [[130, 75], [66, 20]]]) { const p = [a, ...O.route(a, b)]; for (let i = 1; i < p.length; i++) { const horizontal = p[i][1] === p[i - 1][1], vertical = p[i][0] === p[i - 1][0]; const room = O.roomAt(p[i][0], p[i][1]) === O.roomAt(p[i - 1][0], p[i - 1][1]); assert.ok(horizontal || vertical || room, `leg ${p[i - 1]} -> ${p[i]}`); } }
});

test('tools send agents to the right room', () => {
  for (const t of ['write_file', 'read_file', 'list_dir', 'patch', 'search_files', 'remember', 'memory']) assert.equal(O.destFor(t), 'archive', t);
  for (const t of ['web_search', 'open_url', 'browser_navigate', 'browser_snapshot', 'fetch_url', 'look_at_screen']) assert.equal(O.destFor(t), t === 'look_at_screen' ? null : 'comms', t);
  for (const t of ['run_shell', 'terminal', 'execute_code', 'process']) assert.equal(O.destFor(t), 'engineering', t);
  for (const t of ['assign_task', 'thinking', '', undefined]) assert.equal(O.destFor(t), null, String(t));
});

test('a working agent walks to its desk and sits there; an idle one rests in the lounge', () => {
  const w = agent({ state: 'working', station: 3, x: 130, y: 72 }); walk(w, 20); assert.ok(at(w, O.seat(3)), 'at the desk: ' + [w.x, w.y]); assert.equal(w.moving, false);
  const i = agent({ x: O.seat(0)[0], y: O.seat(0)[1] }); walk(i, 20, 0, () => 0.5); assert.equal(O.roomAt(i.x, i.y), 'lounge', 'idle agents end up in the lounge');
});

test('a tool call sends the agent to the room, it stays a few seconds after it ARRIVES, then walks back to the desk', () => {
  const o = agent({ state: 'working', station: 1, x: O.seat(1)[0], y: O.seat(1)[1] }); let t = walk(o, 1); const arch = O.spot('archive', 1), seat1 = O.seat(1);
  O.visit(o, 'archive', t); const t0 = t; let arrived = null;
  const run = (until, each) => { while (t < until) { t += 1 / 30; O.step(o, t, 1 / 30); if (arrived == null && at(o, arch, 0.3) && !o.moving) arrived = t; if (each) each(); } };
  const legs = [seat1, ...O.route(seat1, arch)], len = legs.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - legs[i][0], p[1] - legs[i][1]), 0), expect = len / O.SPEED;
  while (arrived == null && t < t0 + 15) run(t + 1 / 30); assert.ok(arrived && Math.abs(arrived - t0 - expect) < 0.4, `the trip takes ${expect.toFixed(1)} s (${len.toFixed(0)} units at ${O.SPEED}): ` + (arrived && (arrived - t0).toFixed(2)));
  run(arrived + 2.5); assert.ok(at(o, arch, 0.3), 'still in the Archive 2.5 s after arriving');
  O.visit(o, 'archive', t); run(t + 2.5); assert.ok(at(o, arch, 0.3), 'a new call in the same room extends the stay');
  run(t + 8); assert.ok(at(o, seat1), 'back at the desk: ' + [o.x.toFixed(1), o.y.toFixed(1)]); assert.equal(o.dest, null);
});

test('a different room replaces the first, and an agent that stops working goes back to resting', () => {
  const o = agent({ state: 'working', station: 0, x: O.seat(0)[0], y: O.seat(0)[1] }); let t = walk(o, 1);
  O.visit(o, 'archive', t); t = walk(o, 2, t); O.visit(o, 'engineering', t); assert.equal(o.dest, 'engineering'); assert.equal(o.destArrived, null);
  t = walk(o, 6.5, t); assert.ok(at(o, O.spot('engineering', 0), 0.4), 'in Engineering: ' + [o.x, o.y]);
  o.state = 'idle'; t = walk(o, 25, t, () => 0.1); assert.equal(o.dest, null); assert.equal(O.roomAt(o.x, o.y), 'lounge');
});

test('the walk is at the normal speed, and it stops for the door path (no teleporting)', () => {
  const o = agent({ state: 'working', station: 0, x: O.spot('lounge', 0)[0], y: O.spot('lounge', 0)[1] }); walk(o, 1); const d1 = Math.hypot(o.x - 122, o.y - 72);
  assert.ok(d1 > O.SPEED * 0.6 && d1 < O.SPEED * 1.1, 'about ' + O.SPEED + ' units in a second: ' + d1); assert.equal(o.moving, true);
  let prev = [o.x, o.y], t = 1; for (let i = 0; i < 300; i++) { t += 1 / 30; O.step(o, t, 1 / 30); assert.ok(Math.hypot(o.x - prev[0], o.y - prev[1]) <= O.SPEED / 30 + 1e-6, 'no jumps'); prev = [o.x, o.y]; }
});

test('lanes: everyone walks the middle of the hallway in their own lane, and every lane stays inside the hallway', () => {
  const lanes = [0, 1, 2, 3, 4].map(O.laneOf); assert.equal(new Set(lanes).size, 5, 'five different lanes'); for (const l of lanes) assert.ok(O.HALL_Y + l > 38 + 1 && O.HALL_Y + l < 52 - 1, 'inside the hallway: ' + l);
  const seen = {};
  for (const st of [0, 1, 2]) { const o = agent({ state: 'working', station: st, x: O.SPOTS.lounge[st][0], y: O.SPOTS.lounge[st][1] }); let t = 0, prevX = o.x;
    for (let i = 0; i < 30 * 12; i++) { t += 1 / 30; O.step(o, t, 1 / 30); if (O.roomAt(o.x, o.y) === 'hall' && prevX > 100 && o.x <= 100) seen[st] = o.y; prevX = o.x; } }
  for (const st of [0, 1, 2]) assert.ok(Math.abs(seen[st] - (O.HALL_Y + O.laneOf(st))) < 0.05, `station ${st} crosses the middle of the hallway in its lane: ${seen[st]}`);
  assert.equal(new Set(Object.values(seen).map(v => v.toFixed(1))).size, 3, 'three different lines');
  const r = O.route([130, 72], O.seat(0), O.laneOf(3)); assert.ok(r.some(p => p[1] === O.HALL_Y + O.laneOf(3)), 'the route uses the lane');
});
