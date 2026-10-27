// IA des compagnons en solo : elle remplit p.input comme le ferait un joueur.

import { CLASSES } from './data.js';
import { dist, angleDiff } from './util.js';
import { lineOfSight, moveCircle } from './sim.js';

export function botThink(sim, p, dt) {
  const inp = p.input;
  inp.mx = 0; inp.my = 0; inp.b = 0;
  if (p.downed) return;
  const c = CLASSES[p.cls];
  const map = sim.map;
  const leader = sim.players.find((q) => !q.bot && !q.downed) || sim.players.find((q) => !q.bot);
  p.botT = (p.botT || 0) - dt;

  // Coincé ou trop loin du chef : on le rejoint directement.
  if (leader && leader !== p && dist(p.x, p.y, leader.x, leader.y) > 16) {
    sim.placePlayer(p, leader, sim.players.indexOf(p) + 1);
    return;
  }

  // Cible : l'ennemi actif le plus proche visible (et pas marqué comme inaccessible).
  p.ignore ||= new Map();
  let tgt = null, td = Infinity;
  for (const e of sim.enemies) {
    if (e.dead || (p.ignore.get(e.id) || 0) > sim.time) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d > 9.5 || (e.state === 'idle' && d > 5.5) || d >= td) continue;
    if (!lineOfSight(map, p.x, p.y, e.x, e.y)) continue;
    tgt = e; td = d;
  }
  const downed = sim.players.find((q) => q.downed && q !== p && dist(q.x, q.y, p.x, p.y) < 14);
  const hurtAlly = sim.players.find((q) => !q.downed && q.hp < q.maxHp * 0.6 && dist(q.x, q.y, p.x, p.y) < 6);
  const near = (r) => sim.enemies.filter((e) => !e.dead && dist(p.x, p.y, e.x, e.y) < r + e.r).length;

  if (p.hp < p.maxHp * 0.35 && p.potions > 0 && !(p.prevB & 8)) inp.b |= 8;

  let goal = null, want = 0, away = false;
  if (downed) { goal = downed; want = 0.6; }
  else if (tgt) {
    if (c.atk.kind === 'melee') { goal = tgt; want = tgt.r + 0.9; }
    else if (td < 3.2) { goal = tgt; away = true; }
    else if (td > 6.5) { goal = tgt; want = 5.5; }
  } else if (leader && leader !== p && dist(p.x, p.y, leader.x, leader.y) > 3) {
    goal = leader; want = 2.2;
  }

  // Si on n'avance plus vers la cible (rivière, lave…), on l'ignore un moment.
  if (goal && goal === tgt && !away && td > want + 0.3) {
    if (p.chaseId !== tgt.id) { p.chaseId = tgt.id; p.chaseD = td; p.chaseT = sim.time; }
    else if (sim.time - p.chaseT > 1.2) {
      if (td > p.chaseD - 0.4) { p.ignore.set(tgt.id, sim.time + 4); goal = null; }
      p.chaseD = td; p.chaseT = sim.time;
    }
  } else p.chaseId = null;

  if (goal) {
    const d = dist(p.x, p.y, goal.x, goal.y);
    let dx = goal.x - p.x, dy = goal.y - p.y;
    if (away) { dx = -dx; dy = -dy; }
    else if (!lineOfSight(map, p.x, p.y, goal.x, goal.y) && sim.leaderFlow) {
      // Suit le champ de distance vers le chef pour contourner les murs.
      const w = map.w, ix = Math.floor(p.x), iy = Math.floor(p.y);
      const cur = sim.leaderFlow[iy * w + ix];
      if (cur > 0) {
        let bx = ix, by = iy, bv = cur;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const v = sim.leaderFlow[(iy + oy) * w + ix + ox];
          if (v >= 0 && v < bv) { bv = v; bx = ix + ox; by = iy + oy; }
        }
        dx = bx + 0.5 - p.x; dy = by + 0.5 - p.y;
      }
    }
    if (away || d > want) {
      const l = Math.hypot(dx, dy) || 1;
      inp.mx = dx / l; inp.my = dy / l;
    }
  }
  // Sort des zones d'attaque annoncées (cercles, cônes, charges).
  const esc = escapeHazards(sim, p);
  if (esc) { inp.mx = esc[0]; inp.my = esc[1]; }

  // Évite de s'empiler sur les autres membres du groupe.
  for (const q of sim.players) {
    if (q === p) continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < 0.8 && d > 1e-3) moveCircle(map, p, ((p.x - q.x) / d) * 0.6 * dt, ((p.y - q.y) / d) * 0.6 * dt);
  }

  if (tgt) {
    inp.aim = Math.atan2(tgt.y - p.y, tgt.x - p.x);
    const range = c.atk.kind === 'melee' ? c.atk.range + tgt.r : c.atk.speed * c.atk.life;
    if (td < range) inp.b |= 1;
  } else if (inp.mx || inp.my) {
    inp.aim = Math.atan2(inp.my, inp.mx);
  }

  if (p.botT > 0) return;
  p.botT = 0.25;
  if (p.cls === 'guerrier') {
    if (near(2.4) >= 2 || (tgt && tgt.boss && td < 2.5)) inp.b |= 2;
    if (near(6) >= 3 || (hurtAlly && tgt) || (tgt && tgt.boss && td < 4)) inp.b |= 4;
  } else if (p.cls === 'rodeur') {
    if (tgt && td < 8) inp.b |= 2;
    if (tgt && td < 1.6) { inp.b |= 4; inp.mx = -Math.cos(inp.aim); inp.my = -Math.sin(inp.aim); }
  } else if (p.cls === 'mage') {
    if (tgt && td < 8) inp.b |= 2;
    if (near(3.2) >= 1) inp.b |= 4;
  } else if (p.cls === 'clerc') {
    if (hurtAlly || (downed && dist(downed.x, downed.y, p.x, p.y) < 6)) inp.b |= 2;
    if (tgt && near(7) >= 2 && sim.players.some((q) => !q.downed && q.hp < q.maxHp * 0.85)) inp.b |= 4;
  }
}

function escapeHazards(sim, p) {
  let ex = 0, ey = 0;
  for (const h of sim.hazards) {
    const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy) || 1e-3;
    if (h.shape === 'circle') {
      if (d < h.r + 0.6) { ex += dx / d; ey += dy / d; }
    } else if (h.shape === 'cone') {
      const off = angleDiff(h.a, Math.atan2(dy, dx));
      if (d < h.r + 0.6 && Math.abs(off) < h.arc / 2 + 0.25) {
        const side = off >= 0 ? 1 : -1;
        ex += Math.cos(h.a + side * Math.PI / 2); ey += Math.sin(h.a + side * Math.PI / 2);
      }
    } else {
      const ca = Math.cos(h.a), sa = Math.sin(h.a);
      const along = dx * ca + dy * sa, perp = -dx * sa + dy * ca;
      if (along > -0.5 && along < h.len + 0.5 && Math.abs(perp) < h.w / 2 + 0.7) {
        const side = perp >= 0 ? 1 : -1;
        ex += -sa * side; ey += ca * side;
      }
    }
  }
  const l = Math.hypot(ex, ey);
  return l > 0 ? [ex / l, ey / l] : null;
}
