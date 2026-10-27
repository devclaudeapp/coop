// Génération procédurale déterministe des cartes.
// L'hôte et les clients régénèrent la même carte à partir de (graine du monde, id de carte).

import { T, SOLID, DUNGEONS } from './data.js';
import { rng, hashStr, makeNoise, clamp } from './util.js';

function makeMap(id, w, h, fill) {
  const tiles = new Uint8Array(w * h).fill(fill);
  return {
    id, w, h, tiles,
    get(x, y) { return x < 0 || y < 0 || x >= w || y >= h ? T.VOID : tiles[y * w + x]; },
    set(x, y, t) { if (x >= 0 && y >= 0 && x < w && y < h) tiles[y * w + x] = t; },
    solid(x, y) { return SOLID[this.get(x, y)] === 1; },
    exits: [], mobs: [], chests: [], spawn: { x: 0, y: 0 },
  };
}

export function generateMap(worldSeed, mapId) {
  const seed = hashStr(worldSeed + ':' + mapId);
  if (mapId === 'world') return genWorld(seed, mapId);
  const m = /^d(\d)f(\d)$/.exec(mapId);
  return genDungeon(seed, mapId, +m[1], +m[2]);
}

// Distances BFS (4-voisins) depuis une liste de sources.
export function bfs(map, sources, maxDist = 9999) {
  const { w, h } = map;
  const d = new Int16Array(w * h).fill(-1);
  const q = new Int32Array(w * h);
  let qh = 0, qt = 0;
  for (const [x, y] of sources) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x;
    if (d[i] !== -1) continue;
    d[i] = 0; q[qt++] = i;
  }
  while (qh < qt) {
    const i = q[qh++];
    const cd = d[i];
    if (cd >= maxDist) continue;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
    function visit(j) {
      if (d[j] !== -1 || SOLID[map.tiles[j]]) return;
      d[j] = cd + 1; q[qt++] = j;
    }
  }
  return d;
}

// ───────────────────────── Monde extérieur ─────────────────────────

function genWorld(seed, id) {
  const W = 150, H = 110;
  const r = rng(seed);
  const map = makeMap(id, W, H, T.GRASS);
  map.kind = 'world';
  const elev = makeNoise(seed ^ 0x51);
  const forest = makeNoise(seed ^ 0xa7);
  const cx = W >> 1, cy = H >> 1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const border = Math.min(x, y, W - 1 - x, H - 1 - y);
      let t = T.GRASS;
      const e = elev(x / 16, y / 16);
      const f = forest(x / 8, y / 8);
      if (border < 3 || (border < 6 && r() < 0.5)) t = T.TREE;
      else if (e < 0.3) t = T.WATER;
      else if (f > 0.62 || (f > 0.53 && r() < 0.35)) t = T.TREE;
      else if (r() < 0.012) t = T.ROCK;
      else if (r() < 0.05) t = T.FLOWER;
      map.set(x, y, t);
    }
  }

  // Village au centre : place, fontaine, maisons.
  for (let y = cy - 11; y <= cy + 11; y++) {
    for (let x = cx - 13; x <= cx + 13; x++) {
      const dd = ((x - cx) / 13) ** 2 + ((y - cy) / 11) ** 2;
      if (dd <= 1) map.set(x, y, r() < 0.06 ? T.FLOWER : T.GRASS);
      if ((x - cx) ** 2 + (y - cy) ** 2 <= 16) map.set(x, y, T.PATH);
    }
  }
  for (let y = cy - 1; y <= cy; y++) for (let x = cx - 1; x <= cx; x++) map.set(x, y, T.FOUNTAIN);
  const houses = [[cx - 10, cy - 8], [cx + 6, cy - 8], [cx - 10, cy + 5], [cx + 6, cy + 5]];
  for (const [hx, hy] of houses) {
    for (let y = hy; y < hy + 3; y++) for (let x = hx; x < hx + 4; x++) map.set(x, y, T.HOUSE);
  }
  map.fountain = { x: cx, y: cy };
  map.spawn = { x: cx + 0.5, y: cy + 3.5 };

  // Entrées de donjon, de plus en plus loin du village.
  const a0 = r() * Math.PI * 2;
  const dists = [26, 40, 52];
  map.entrances = [];
  for (let i = 0; i < DUNGEONS.length; i++) {
    const a = a0 + i * 2.15;
    const ex = clamp(Math.round(cx + Math.cos(a) * dists[i] * 1.25), 8, W - 9);
    const ey = clamp(Math.round(cy + Math.sin(a) * dists[i] * 0.9), 8, H - 9);
    for (let y = ey - 3; y <= ey + 5; y++) for (let x = ex - 4; x <= ex + 4; x++) map.set(x, y, T.GRASS);
    for (let x = ex - 3; x <= ex + 3; x++) { map.set(x, ey - 1, T.ROCK); map.set(x, ey - 2, T.ROCK); }
    for (const x of [ex - 3, ex - 2, ex - 1, ex + 1, ex + 2, ex + 3]) map.set(x, ey, T.ROCK);
    map.set(ex, ey, T.ENTRANCE);
    map.entrances.push({ x: ex, y: ey });
    map.exits.push({ x: ex, y: ey, kind: 'entrance', dungeon: i, target: `d${i}f0` });
    carvePath(map, r, cx + Math.round(Math.cos(a) * 5), cy + Math.round(Math.sin(a) * 5), ex, ey + 2);
  }

  // Tout ce qui n'est pas accessible depuis le village devient forêt.
  const reach = bfs(map, [[cx, cy + 3]]);
  for (let i = 0; i < W * H; i++) {
    if (reach[i] === -1 && !SOLID[map.tiles[i]] && map.tiles[i] !== T.ENTRANCE) map.tiles[i] = T.TREE;
  }

  // Camps d'ennemis : plus on s'éloigne du village, plus c'est dangereux.
  const free = (x, y) => reach[y * W + x] > 0 && !SOLID[map.get(x, y)];
  let camps = 0, tries = 0;
  while (camps < 28 && tries++ < 3000) {
    const x = r.int(4, W - 5), y = r.int(4, H - 5);
    const d = Math.hypot(x - cx, y - cy);
    if (d < 16 || !free(x, y)) continue;
    if (map.entrances.some((e) => Math.hypot(e.x - x, e.y + 2 - y) < 6)) continue;
    const tier = clamp((d - 14) / 45, 0, 1.2);
    const pool = d < 28 ? ['slime', 'slime', 'loup'] : d < 42 ? ['loup', 'gobelin', 'slime'] : ['gobelin', 'loup', 'brute', 'gobelin'];
    const n = r.int(2, 4);
    for (let k = 0; k < n; k++) {
      const mx = x + r.int(-2, 2), my = y + r.int(-2, 2);
      if (free(mx, my)) map.mobs.push({ type: r.pick(pool), x: mx + 0.5, y: my + 0.5, tier });
    }
    camps++;
  }
  let chests = 0; tries = 0;
  while (chests < 7 && tries++ < 3000) {
    const x = r.int(4, W - 5), y = r.int(4, H - 5);
    if (Math.hypot(x - cx, y - cy) < 18 || !free(x, y)) continue;
    map.chests.push({ x: x + 0.5, y: y + 0.5 });
    chests++;
  }
  return map;
}

function carvePath(map, r, x, y, tx, ty) {
  let steps = 0;
  const carve = (px, py) => {
    for (let oy = 0; oy < 2; oy++) {
      for (let ox = 0; ox < 2; ox++) {
        const t = map.get(px + ox, py + oy);
        if (t === T.WATER) map.set(px + ox, py + oy, T.BRIDGE);
        else if (t !== T.ENTRANCE && t !== T.FOUNTAIN && t !== T.HOUSE && t !== T.BRIDGE && t !== T.VOID) map.set(px + ox, py + oy, T.PATH);
      }
    }
  };
  while ((x !== tx || y !== ty) && steps++ < 4000) {
    const dx = tx - x, dy = ty - y;
    if (r() < 0.72) {
      if (Math.abs(dx) > Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy);
    } else if (r() < 0.5) {
      x += dx === 0 ? (r() < 0.5 ? -1 : 1) : Math.sign(dx);
    } else {
      y += dy === 0 ? (r() < 0.5 ? -1 : 1) : Math.sign(dy);
    }
    x = clamp(x, 4, map.w - 6); y = clamp(y, 4, map.h - 6);
    carve(x, y);
  }
}

// ───────────────────────── Donjons ─────────────────────────

function genDungeon(seed, id, di, f) {
  const D = DUNGEONS[di];
  const last = f === D.floors - 1;
  const W = 72, H = 56;
  const r = rng(seed);
  const map = makeMap(id, W, H, T.WALL);
  map.kind = 'dungeon';
  map.theme = D.theme;
  map.dungeon = di;
  map.floor = f;

  const rooms = [];
  const target = 9 + f * 2 + di;
  for (let tries = 0; tries < 500 && rooms.length < target; tries++) {
    const w = r.int(7, 12), h = r.int(6, 9);
    const x = r.int(3, W - w - 4), y = r.int(3, H - h - 4);
    if (rooms.some((o) => x < o.x + o.w + 3 && x + w + 3 > o.x && y < o.y + o.h + 3 && y + h + 3 > o.y)) continue;
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
  }
  const carveRect = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      if (x > 1 && y > 1 && x < W - 2 && y < H - 2) map.set(x, y, T.FLOOR);
    }
  };
  for (const rm of rooms) carveRect(rm.x, rm.y, rm.w, rm.h);

  const corridor = (a, b) => {
    const hFirst = r() < 0.5;
    const hx = (y, x0, x1) => carveRect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 2, 2);
    const vy = (x, y0, y1) => carveRect(x, Math.min(y0, y1), 2, Math.abs(y1 - y0) + 2);
    if (hFirst) { hx(a.cy, a.cx, b.cx); vy(b.cx, a.cy, b.cy); } else { vy(a.cx, a.cy, b.cy); hx(b.cy, a.cx, b.cx); }
  };
  // Arbre couvrant minimal (Prim) + quelques boucles.
  const linked = [rooms[0]];
  const rest = rooms.slice(1);
  while (rest.length) {
    let best = null, bd = Infinity;
    for (const a of linked) for (const b of rest) {
      const d = Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
      if (d < bd) { bd = d; best = [a, b]; }
    }
    corridor(best[0], best[1]);
    linked.push(best[1]);
    rest.splice(rest.indexOf(best[1]), 1);
  }
  for (let k = 0; k < 3; k++) {
    const a = r.pick(rooms), b = r.pick(rooms);
    if (a !== b && Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy) < 30) corridor(a, b);
  }

  const start = rooms[0];
  const dist = bfs(map, [[start.cx, start.cy]]);
  let end = rooms[1] || start, ed = -1;
  for (const rm of rooms) {
    const d = dist[rm.cy * W + rm.cx];
    if (rm !== start && d > ed) { ed = d; end = rm; }
  }
  if (last) {
    // Salle du boss agrandie.
    const bw = Math.max(end.w, 17), bh = Math.max(end.h, 13);
    end.x = clamp(end.cx - (bw >> 1), 3, W - bw - 3);
    end.y = clamp(end.cy - (bh >> 1), 3, H - bh - 3);
    end.w = bw; end.h = bh;
    end.cx = end.x + (bw >> 1); end.cy = end.y + (bh >> 1);
    carveRect(end.x, end.y, bw, bh);
    end.boss = true;
  }
  const inEnd = (x, y) => x >= end.x - 1 && x <= end.x + end.w && y >= end.y - 1 && y <= end.y + end.h;

  // Décor selon le thème (toujours à l'intérieur des salles pour ne rien bloquer).
  for (const rm of rooms) {
    if (rm === start || rm === end || rm.w < 9 || rm.h < 7) continue;
    if (D.theme === 'crypt') {
      for (let x = rm.x + 2; x < rm.x + rm.w - 2; x += 3) {
        map.set(x, rm.y + 2, T.PILLAR); map.set(x, rm.y + rm.h - 3, T.PILLAR);
      }
    } else if (D.theme === 'mine') {
      for (let k = 0; k < 3; k++) map.set(r.int(rm.x + 2, rm.x + rm.w - 3), r.int(rm.y + 2, rm.y + rm.h - 3), T.CRYSTAL);
    } else {
      const lx = r.int(rm.x + 2, rm.x + rm.w - 4), ly = r.int(rm.y + 2, rm.y + rm.h - 4);
      for (let y = ly; y < ly + 2; y++) for (let x = lx; x < lx + 2; x++) map.set(x, y, T.LAVA);
    }
  }
  if (last && D.theme === 'lair') {
    for (const [ox, oy] of [[3, 3], [end.w - 4, 3], [3, end.h - 4], [end.w - 4, end.h - 4]]) map.set(end.x + ox, end.y + oy, T.LAVA);
  } else if (last) {
    for (const [ox, oy] of [[3, 3], [end.w - 4, 3], [3, end.h - 4], [end.w - 4, end.h - 4]]) map.set(end.x + ox, end.y + oy, T.PILLAR);
  }

  // Sortie vers le monde, encastrée dans le mur du haut de la salle de départ.
  map.set(start.cx, start.y - 1, T.EXIT);
  map.exits.push({ x: start.cx, y: start.y - 1, kind: 'exit', target: 'world', dungeon: di });
  map.spawn = { x: start.cx + 0.5, y: start.cy + 1.0 };
  if (!last) {
    map.set(end.cx, end.cy, T.STAIRS);
    map.exits.push({ x: end.cx, y: end.cy, kind: 'stairs', target: `d${di}f${f + 1}`, dungeon: di });
  } else {
    map.bossSpawn = { x: end.cx + 0.5, y: end.cy + 0.5 };
    map.bossRoom = { x: end.x, y: end.y, w: end.w, h: end.h };
  }

  const tier = di + f * 0.3;
  const free = (x, y) => map.get(x, y) === T.FLOOR;
  for (const rm of rooms) {
    if (rm === start || (last && rm === end) || (last && inEnd(rm.cx, rm.cy))) continue;
    const n = r.int(2, 4) + (f > 0 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const x = r.int(rm.x + 1, rm.x + rm.w - 2), y = r.int(rm.y + 1, rm.y + rm.h - 2);
      if (free(x, y)) map.mobs.push({ type: r.pick(D.mobs), x: x + 0.5, y: y + 0.5, tier });
    }
  }
  const chestRooms = rooms.filter((rm) => rm !== start && rm !== end);
  const nChests = Math.min(chestRooms.length, r.int(2, 3));
  for (let k = 0; k < nChests; k++) {
    const rm = chestRooms.splice(r.int(0, chestRooms.length - 1), 1)[0];
    const x = rm.x + 1, y = rm.y + 1;
    if (free(x, y)) map.chests.push({ x: x + 0.5, y: y + 0.5 });
  }
  map.rooms = rooms;
  return map;
}
