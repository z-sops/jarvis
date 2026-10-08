/* Office: the rules of the floor plan and of moving around it. No drawing and no page code here, so it can be tested on its own.
   World units: 160 wide, 90 high. A hallway runs across the middle; rooms open onto it through one door each. */
(function (root) {
  'use strict';
  const W = 160, H = 90, HALL_Y = 45, SPEED = 22;
  const ROOMS = {
    command: { name: 'Command', x: 6, y: 6, w: 38, h: 32, door: 25 },
    archive: { name: 'Archive', x: 48, y: 6, w: 36, h: 32, door: 66 },
    comms: { name: 'Comms', x: 88, y: 6, w: 34, h: 32, door: 105 },
    engineering: { name: 'Engineering', x: 126, y: 6, w: 28, h: 32, door: 140 },
    desks: { name: 'Open office', x: 6, y: 52, w: 104, h: 32, door: 58 },
    lounge: { name: 'Lounge', x: 114, y: 52, w: 40, h: 32, door: 134 }
  };
  const SPOTS = {
    command: [[25, 15]], archive: [[54, 33], [66, 33], [78, 33], [60, 27], [72, 27]], comms: [[94, 33], [105, 33], [116, 33]], engineering: [[132, 33], [140, 33], [148, 33]],
    lounge: [[122, 72], [130, 74], [138, 72], [146, 74], [126, 62], [142, 62], [132, 80]]
  };
  const DESK_COLS = 6;
  const deskCenter = i => [16 + (i % DESK_COLS) * 16, 62 + (Math.floor(i / DESK_COLS) % 2) * 14];
  const seat = i => { const c = deskCenter(i); return [c[0], c[1] + 4.6]; };
  const spot = (room, n) => SPOTS[room][Math.abs(n | 0) % SPOTS[room].length];
  const doorPoint = r => [r.door, r.y < HALL_Y ? r.y + r.h : r.y];

  function roomAt(x, y) { for (const id of Object.keys(ROOMS)) { const r = ROOMS[id]; if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return id; } return 'hall'; }

  // Waypoints from one place to another: out of the room by its door, along the hallway, in by the other door.
  // Each person walks in their own lane of the hallway (lane is -3 to +3 units off the middle) so nobody walks through anybody.
  const laneOf = station => (((station | 0) % 5) - 2) * 1.5;
  function route(from, to, lane = 0) {
    const A = roomAt(from[0], from[1]), B = roomAt(to[0], to[1]); if (A === B) return [to.slice()];
    const pts = [], hy = HALL_Y + lane;
    if (A !== 'hall') { const d = doorPoint(ROOMS[A]); pts.push(d, [d[0], hy]); } else if (Math.abs(from[1] - hy) > 0.5) pts.push([from[0], hy]);
    if (B !== 'hall') { const d = doorPoint(ROOMS[B]); pts.push([d[0], hy], d); }
    pts.push(to.slice());
    return pts.filter((p, i) => i === 0 ? Math.hypot(p[0] - from[0], p[1] - from[1]) > 0.01 : Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01);
  }

  // Where a tool takes an agent: files to the Archive, the web to Comms, commands to Engineering, anything else: stay at the desk.
  function destFor(tool) {
    const t = String(tool || '').toLowerCase(); if (!t) return null;
    if (/file|dir|folder|read|write|patch|edit|glob|grep|memory|remember|save/.test(t) && !/web|browser|url|http/.test(t)) return 'archive';
    if (/web|browser|fetch|http|url|navigate|click|screenshot|search|snapshot/.test(t)) return 'comms';
    if (/terminal|shell|exec|bash|command|process|python|code|run|script/.test(t)) return 'engineering';
    return null;
  }

  // A tool call sends the agent to a room. It stays there a few seconds AFTER it arrives (a new call in the same room extends the stay).
  function visit(o, room, t, hold = 3) {
    if (o.dest === room) { if (o.destArrived != null) o.destArrived = t; } else { o.dest = room; o.destArrived = null; o.destAt = t; }
    o.destHold = hold;
  }

  // One step of an agent's life. o: { x, y, state, station, dest, path, goalKey, wander, wanderAt, moving }. t in seconds.
  function step(o, t, dt, rand = Math.random) {
    let goal;
    if (o.state === 'working') {
      if (o.dest) {
        const dp = spot(o.dest, o.station);
        if (o.destArrived == null && Math.hypot(o.x - dp[0], o.y - dp[1]) < 0.4 && !(o.path && o.path.length)) o.destArrived = t;
        if ((o.destArrived != null && t - o.destArrived > (o.destHold || 3)) || t - (o.destAt || t) > 40) { o.dest = null; o.destArrived = null; }
      }
      goal = o.dest ? spot(o.dest, o.station) : seat(o.station);
    } else {
      o.dest = null; o.destArrived = null; if (!o.wander || t > o.wanderAt) { o.wander = spot('lounge', (rand() * SPOTS.lounge.length) | 0); o.wanderAt = t + 6 + rand() * 9; } goal = o.wander;
    }
    const key = goal[0] + ',' + goal[1]; if (o.goalKey !== key) { o.goalKey = key; o.path = route([o.x, o.y], goal, laneOf(o.station)); }
    let left = SPEED * dt; o.moving = false;
    while (o.path && o.path.length && left > 0) {
      const p = o.path[0], dx = p[0] - o.x, dy = p[1] - o.y, d = Math.hypot(dx, dy);
      if (d <= left) { o.x = p[0]; o.y = p[1]; left -= d; o.path.shift(); } else { o.x += dx / d * left; o.y += dy / d * left; left = 0; o.moving = true; }
    }
    if (o.path && o.path.length) o.moving = true;
    return o;
  }

  const api = { W, H, HALL_Y, SPEED, ROOMS, SPOTS, DESK_COLS, deskCenter, seat, spot, doorPoint, roomAt, route, laneOf, destFor, visit, step };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OfficeCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
