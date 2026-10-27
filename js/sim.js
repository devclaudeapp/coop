// Simulation de la partie. Tourne chez l'hôte (ou en solo) et fait autorité.
// Les clients reçoivent des instantanés (snapshot) et ne font que prédire leur propre déplacement.

import {
  T, SOLID, BLOCK_SHOT, CLASSES, ENEMIES, ENEMY_IDS, DUNGEONS, ITEM_IDS, PROJ_IDS,
  MAX_PARTY, MAX_POTIONS, xpForLevel, mapName,
} from './data.js';
import { generateMap, bfs } from './mapgen.js';
import { clamp, dist, angleDiff, TAU, r2 } from './util.js';
import { botThink } from './bot.js';

export const PLAYER_R = 0.32;

export function collides(map, x, y, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!SOLID[map.get(tx, ty)]) continue;
      const nx = clamp(x, tx, tx + 1), ny = clamp(y, ty, ty + 1);
      if ((nx - x) ** 2 + (ny - y) ** 2 < r * r) return true;
    }
  }
  return false;
}

export function moveCircle(map, e, dx, dy) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.1));
  const sx = dx / steps, sy = dy / steps;
  let hit = false;
  for (let i = 0; i < steps; i++) {
    if (sx) { e.x += sx; if (collides(map, e.x, e.y, e.r)) { e.x -= sx; hit = true; } }
    if (sy) { e.y += sy; if (collides(map, e.x, e.y, e.r)) { e.y -= sy; hit = true; } }
  }
  return hit;
}

// Déplacement d'un joueur, partagé par l'hôte et la prédiction client.
export function stepPlayerMove(map, p, mx, my, dt) {
  const sp = CLASSES[p.cls].speed;
  moveCircle(map, p, mx * sp * dt, my * sp * dt);
}

export function lineOfSight(map, ax, ay, bx, by) {
  const n = Math.ceil(dist(ax, ay, bx, by) / 0.25);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (BLOCK_SHOT[map.get(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t))]) return false;
  }
  return true;
}

export function exitLabel(ex) {
  if (ex.kind === 'entrance') return `Entrer : ${DUNGEONS[ex.dungeon].name}`;
  if (ex.kind === 'stairs') return 'Descendre à l’étage suivant';
  if (ex.kind === 'portal') return 'Portail vers la vallée';
  return 'Remonter à la surface';
}

const SHAPES = { circle: 0, cone: 1, line: 2 };

export class Sim {
  constructor({ worldSeed, cleared }) {
    this.worldSeed = worldSeed;
    this.cleared = cleared ? cleared.slice() : DUNGEONS.map(() => false);
    this.players = [];
    this.fx = [];
    this.nextId = 1;
    this.time = 0;
    this.tick = 0;
    this.victory = false;
    this.loadMap('world', null);
  }

  newId() { return this.nextId++; }
  emit(ev) { this.fx.push(ev); }
  msg(text, c = '#ffffff') { this.emit({ t: 'msg', text, c }); }
  drainFx() { const f = this.fx; this.fx = []; return f; }
  player(id) { return this.players.find((p) => p.id === id); }
  humans() { return this.players.filter((p) => !p.bot); }
  partyN() { return this.humans().length + (this.players.length - this.humans().length) * 0.7 || 1; }

  // ───────────── Cartes ─────────────

  loadMap(mapId, fromDungeon) {
    this.map = generateMap(this.worldSeed, mapId);
    this.mapId = mapId;
    this.enemies = [];
    this.projs = [];
    this.items = [];
    this.hazards = [];
    this.portal = null;
    this.mapAge = 0;
    this.gather = null;
    this.gatherT = 0;
    this.wipeT = 0;
    this.flowT = 0;
    for (const m of this.map.mobs) this.spawnEnemy(m.type, m.x, m.y, m.tier);
    for (const c of this.map.chests) this.items.push({ id: this.newId(), type: 'chest', x: c.x, y: c.y });
    if (this.map.bossSpawn) {
      const D = DUNGEONS[this.map.dungeon];
      this.spawnEnemy(D.boss, this.map.bossSpawn.x, this.map.bossSpawn.y, this.map.dungeon * 0.3);
    }
    let sp = this.map.spawn;
    if (mapId === 'world' && fromDungeon != null) {
      const e = this.map.entrances[fromDungeon];
      sp = { x: e.x + 0.5, y: e.y + 3.5 };
    }
    this.spawnPoint = sp;
    this.players.forEach((p, i) => {
      if (p.downed) { p.downed = false; p.hp = Math.round(p.maxHp * 0.3); }
      p.dashT = 0;
      p.moveQ.length = 0;
      if (p.bot) p.potions = Math.max(p.potions, 2);
      this.placePlayer(p, sp, i);
    });
    this.msg(mapName(mapId), '#ffe082');
  }

  placePlayer(p, at, i) {
    const offs = [[0, 0], [1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1], [0, -1]];
    for (let k = 0; k < offs.length; k++) {
      const [ox, oy] = offs[(i + k) % offs.length];
      p.x = at.x + ox; p.y = at.y + oy;
      if (!collides(this.map, p.x, p.y, p.r)) return;
    }
    p.x = at.x; p.y = at.y;
  }

  // ───────────── Joueurs ─────────────

  addPlayer({ name, cls, char, bot = false, remote = false }) {
    const ch = char || {};
    const p = {
      id: this.newId(), name: String(name || 'Héros').slice(0, 16), cls: CLASSES[cls] ? cls : 'guerrier',
      bot, remote, x: 0, y: 0, r: PLAYER_R,
      level: clamp(ch.level | 0, 1, 99) || 1, xp: Math.max(0, ch.xp | 0),
      gems: clamp(ch.gems | 0, 0, 200), hearts: clamp(ch.hearts | 0, 0, 200),
      potions: clamp(ch.potions ?? 2, 0, MAX_POTIONS),
      hp: 1, maxHp: 1, dmgMul: 1, aim: 0, downed: false, revive: 0, shield: 0, shieldT: 0,
      guardT: 0, invT: 0, dashT: 0, dashVx: 0, dashVy: 0, cd: [0, 0, 0], potCd: 0, fountT: 0,
      lastHurt: -99, input: { mx: 0, my: 0, aim: 0, b: 0 }, prevB: 0, moveQ: [], ack: 0,
    };
    if (bot) {
      const hs = this.humans();
      p.level = hs.length ? Math.max(...hs.map((h) => h.level)) : 1;
    }
    this.recalc(p);
    p.hp = p.maxHp;
    this.players.push(p);
    const leader = this.players.find((q) => !q.bot && q !== p && !q.downed);
    this.placePlayer(p, leader || this.spawnPoint, this.players.length);
    return p;
  }

  removePlayer(id) {
    const p = this.player(id);
    if (!p) return;
    this.players.splice(this.players.indexOf(p), 1);
    for (const e of this.enemies) if (e.tauntId === id) e.tauntT = 0;
  }

  // Fait de la place pour un humain en retirant un compagnon IA si le groupe est complet.
  canJoin() {
    if (this.players.length < MAX_PARTY) return true;
    const bot = this.players.find((p) => p.bot);
    if (!bot) return false;
    this.removePlayer(bot.id);
    return true;
  }

  recalc(p) {
    const c = CLASSES[p.cls];
    const ratio = p.maxHp > 1 ? p.hp / p.maxHp : 1;
    p.maxHp = Math.round(c.hp * (1 + 0.1 * (p.level - 1)) + p.hearts * 12);
    p.hp = Math.min(p.maxHp, Math.max(1, Math.round(p.maxHp * ratio)));
    p.dmgMul = (1 + 0.1 * (p.level - 1)) * (1 + 0.06 * p.gems);
  }

  charData(p) {
    return { level: p.level, xp: Math.floor(p.xp), gems: p.gems, hearts: p.hearts, potions: p.potions };
  }

  gainXp(p, xp) {
    p.xp += xp;
    while (p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      p.level++;
      this.recalc(p);
      p.hp = p.maxHp;
      this.emit({ t: 'lvl', x: p.x, y: p.y });
      if (!p.bot) this.msg(`${p.name} passe niveau ${p.level} !`, '#fff59d');
    }
  }

  // ───────────── Boucle ─────────────

  step(dt) {
    this.time += dt;
    this.tick++;
    this.mapAge += dt;
    this.flowT -= dt;
    if (this.flowT <= 0) { this.flowT = 0.3; this.updateFlow(); }
    for (const p of this.players) {
      if (p.bot) botThink(this, p, dt);
      this.updatePlayer(p, dt);
    }
    this.updateEnemies(dt);
    this.updateProjs(dt);
    this.updateHazards(dt);
    this.updateItems();
    this.updateParty(dt);
  }

  updateFlow() {
    const src = this.players.filter((p) => !p.downed).map((p) => [Math.floor(p.x), Math.floor(p.y)]);
    this.flow = src.length ? bfs(this.map, src, this.map.kind === 'world' ? 60 : 45) : null;
    const leader = this.players.find((p) => !p.bot && !p.downed);
    this.leaderFlow = leader ? bfs(this.map, [[Math.floor(leader.x), Math.floor(leader.y)]], 60) : null;
  }

  updatePlayer(p, dt) {
    for (let i = 0; i < 3; i++) p.cd[i] = Math.max(0, p.cd[i] - dt);
    p.potCd = Math.max(0, p.potCd - dt);
    p.guardT = Math.max(0, p.guardT - dt);
    p.invT = Math.max(0, p.invT - dt);
    if (p.shieldT > 0) { p.shieldT -= dt; if (p.shieldT <= 0) p.shield = 0; }

    const q = p.moveQ;
    if (p.downed) {
      if (q.length) { p.ack = q[q.length - 1][0]; q.length = 0; }
      p.prevB = p.input.b;
      return;
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
      moveCircle(this.map, p, p.dashVx * dt, p.dashVy * dt);
      if (q.length) { p.ack = q[q.length - 1][0]; q.length = 0; }
    } else if (p.remote) {
      let budget = 0.3;
      for (const f of q) {
        const fdt = Math.min(f[3], 0.1);
        if (budget > 0) { stepPlayerMove(this.map, p, f[1], f[2], fdt); budget -= fdt; }
        p.ack = f[0];
      }
      q.length = 0;
    } else {
      stepPlayerMove(this.map, p, p.input.mx, p.input.my, dt);
    }
    p.aim = p.input.aim;

    const b = p.input.b, pressed = b & ~p.prevB;
    p.prevB = b;
    if (b & 1 && p.cd[0] <= 0) this.primary(p);
    if (b & 2 && p.cd[1] <= 0) this.skill1(p);
    if (b & 4 && p.cd[2] <= 0) this.skill2(p);
    if (pressed & 8) this.drinkPotion(p);

    if (this.time - p.lastHurt > 6 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.03 * dt);
    const f = this.map.fountain;
    if (f && dist(p.x, p.y, f.x, f.y) < 3.6) {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.25 * dt);
      p.fountT += dt;
      if (p.fountT > 1.5 && p.potions < 3) { p.potions++; p.fountT = 0; this.emit({ t: 'heal', x: p.x, y: p.y }); }
    }
  }

  // ───────────── Compétences ─────────────

  primary(p) {
    const a = CLASSES[p.cls].atk;
    p.cd[0] = a.cd;
    const dmg = a.dmg * p.dmgMul;
    if (a.kind === 'melee') {
      this.emit({ t: 'swing', x: p.x, y: p.y, a: p.aim, arc: a.arc, r: a.range, c: CLASSES[p.cls].color });
      let hits = 0;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = dist(p.x, p.y, e.x, e.y);
        if (d > a.range + e.r) continue;
        if (d > e.r + 0.3 && Math.abs(angleDiff(p.aim, Math.atan2(e.y - p.y, e.x - p.x))) > a.arc / 2) continue;
        this.hurtEnemy(e, dmg, p);
        this.knock(e, p.x, p.y, 0.25);
        hits++;
      }
      if (a.lifeOnHit && hits) this.heal(p, p.maxHp * a.lifeOnHit * Math.min(hits, 3), true);
      if (a.healOnHit && hits) {
        const ally = this.players
          .filter((q) => !q.downed && dist(q.x, q.y, p.x, p.y) < 7)
          .sort((u, v) => u.hp / u.maxHp - v.hp / v.maxHp)[0];
        if (ally) this.heal(ally, ally.maxHp * 0.03 * Math.min(hits, 3));
      }
    } else {
      this.shoot(p, a.proj, p.aim, a.speed, dmg, a.life);
    }
  }

  skill1(p) {
    const c = CLASSES[p.cls];
    p.cd[1] = c.s1.cd;
    const base = c.atk.dmg * p.dmgMul;
    if (p.cls === 'guerrier') {
      this.emit({ t: 'spin', x: p.x, y: p.y, r: 2.5, c: c.color });
      for (const e of this.enemies) {
        if (!e.dead && dist(p.x, p.y, e.x, e.y) < 2.5 + e.r) { this.hurtEnemy(e, base * 2.2, p); this.knock(e, p.x, p.y, 1.2); }
      }
    } else if (p.cls === 'rodeur') {
      for (let k = -2; k <= 2; k++) this.shoot(p, 'arrow', p.aim + k * 0.13, 18, base * 0.95, 0.6, { pierce: 1 });
    } else if (p.cls === 'mage') {
      this.shoot(p, 'fireball', p.aim, 10, base * 2.4, 0.9, { aoe: 2.3, r: 0.25 });
    } else if (p.cls === 'clerc') {
      this.emit({ t: 'nova', x: p.x, y: p.y, r: 6.5, c: '#fff59d' });
      for (const q of this.players) {
        if (dist(q.x, q.y, p.x, p.y) > 6.5) continue;
        if (q.downed) q.revive = Math.min(0.99, q.revive + 0.5);
        else this.heal(q, q.maxHp * 0.32);
      }
    }
  }

  skill2(p) {
    const c = CLASSES[p.cls];
    p.cd[2] = c.s2.cd;
    const base = c.atk.dmg * p.dmgMul;
    if (p.cls === 'guerrier') {
      p.guardT = 5;
      this.emit({ t: 'nova', x: p.x, y: p.y, r: 8, c: '#ff8a65' });
      for (const e of this.enemies) {
        if (e.dead || dist(p.x, p.y, e.x, e.y) > 8) continue;
        e.tauntId = p.id; e.tauntT = 5;
        this.aggro(e, p);
      }
    } else if (p.cls === 'rodeur') {
      let dx = p.input.mx, dy = p.input.my;
      if (Math.hypot(dx, dy) < 0.2) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
      const l = Math.hypot(dx, dy);
      p.dashVx = (dx / l) * 15; p.dashVy = (dy / l) * 15;
      p.dashT = 0.22; p.invT = 0.35;
      this.emit({ t: 'dash', x: p.x, y: p.y, c: c.color });
    } else if (p.cls === 'mage') {
      this.emit({ t: 'nova', x: p.x, y: p.y, r: 3.6, c: '#81d4fa' });
      for (const e of this.enemies) {
        if (e.dead || dist(p.x, p.y, e.x, e.y) > 3.6 + e.r) continue;
        this.hurtEnemy(e, base * 1.1, p);
        e.slowT = e.boss ? 1.5 : 3.5;
      }
    } else if (p.cls === 'clerc') {
      this.emit({ t: 'nova', x: p.x, y: p.y, r: 6.5, c: '#80deea' });
      for (const q of this.players) {
        if (q.downed || dist(q.x, q.y, p.x, p.y) > 6.5) continue;
        q.shield = Math.max(q.shield, Math.round(q.maxHp * 0.3));
        q.shieldT = 6;
      }
    }
  }

  drinkPotion(p) {
    if (p.potions <= 0 || p.potCd > 0 || p.hp >= p.maxHp) return;
    p.potions--;
    p.potCd = 1;
    this.heal(p, p.maxHp * 0.45);
  }

  heal(p, amount, quiet = false) {
    const v = Math.min(amount, p.maxHp - p.hp);
    if (v <= 0) return;
    p.hp += v;
    if (quiet) return;
    this.emit({ t: 'dmg', x: p.x, y: p.y - 0.5, v: '+' + Math.round(v), c: '#69f0ae' });
    this.emit({ t: 'heal', x: p.x, y: p.y });
  }

  shoot(owner, type, ang, speed, dmg, life, opts = {}) {
    const isP = !!owner.cls;
    this.projs.push({
      id: this.newId(), side: isP ? 'p' : 'e', owner: owner.id, type,
      x: owner.x + Math.cos(ang) * (owner.r * 0.8), y: owner.y + Math.sin(ang) * (owner.r * 0.8),
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, dmg, life, r: opts.r || 0.14,
      aoe: opts.aoe || 0, pierce: opts.pierce || 0, hits: null,
    });
  }

  // ───────────── Dégâts ─────────────

  hurtEnemy(e, dmg, src) {
    if (e.dead) return;
    e.calmT = 0;
    dmg = Math.max(1, Math.round(dmg * (0.9 + Math.random() * 0.2)));
    e.hp -= dmg;
    e.flash = 0.12;
    this.emit({ t: 'dmg', x: e.x, y: e.y - e.r, v: dmg, c: '#ffffff' });
    if (src) this.aggro(e, src);
    if (e.hp <= 0) this.killEnemy(e);
  }

  aggro(e, target) {
    if (e.state !== 'idle') return;
    e.state = 'chase';
    e.target = target.id;
    if (e.boss) { this.msg(ENEMIES[e.type].name + ' se réveille !', '#ff8a80'); this.emit({ t: 'boss' }); }
    for (const o of this.enemies) {
      if (o !== e && o.state === 'idle' && !o.boss && dist(o.x, o.y, e.x, e.y) < 5) { o.state = 'chase'; o.target = target.id; }
    }
  }

  knock(e, fx, fy, power) {
    if (e.boss) power *= 0.1;
    const d = dist(e.x, e.y, fx, fy) || 1;
    moveCircle(this.map, e, ((e.x - fx) / d) * power, ((e.y - fy) / d) * power);
  }

  killEnemy(e) {
    e.dead = true;
    e.hp = 0;
    this.emit({ t: 'die', x: e.x, y: e.y, r: e.r, c: ENEMIES[e.type].color });
    for (const p of this.players) this.gainXp(p, e.xp);
    if (e.boss) this.bossDefeated(e);
    else if (Math.random() < 0.08) this.drop('potion', e.x, e.y);
  }

  bossDefeated(e) {
    const di = this.map.dungeon;
    const first = !this.cleared[di];
    this.cleared[di] = true;
    for (const o of this.enemies) if (!o.dead && o !== e) { o.dead = true; this.emit({ t: 'die', x: o.x, y: o.y, r: o.r, c: '#999' }); }
    this.hazards.length = 0;
    this.items.push({ id: this.newId(), type: 'bigchest', x: e.x, y: e.y });
    this.portal = { x: Math.floor(e.x), y: Math.floor(e.y) + 2, kind: 'portal', target: 'world', dungeon: di };
    if (collides(this.map, this.portal.x + 0.5, this.portal.y + 0.5, 0.3)) this.portal.y -= 4;
    this.msg(`${ENEMIES[e.type].name} est vaincu !`, '#ffd54f');
    if (di === DUNGEONS.length - 1) {
      this.victory = true;
      this.emit({ t: 'victory' });
    } else if (first) {
      this.msg(`Nouveau donjon accessible : ${DUNGEONS[di + 1].name}`, '#80deea');
    }
  }

  hurtPlayer(p, dmg) {
    if (p.downed || p.invT > 0) return;
    if (p.guardT > 0) dmg *= 0.5;
    if (this.players.length === 1) dmg *= 0.85; // vraiment seul : un peu plus clément
    dmg = Math.max(1, Math.round(dmg * (0.9 + Math.random() * 0.2)));
    if (p.shield > 0) {
      const a = Math.min(p.shield, dmg);
      p.shield -= a;
      dmg -= a;
      if (a) this.emit({ t: 'dmg', x: p.x, y: p.y - 0.5, v: a, c: '#80deea' });
    }
    if (dmg <= 0) return;
    p.hp -= dmg;
    p.lastHurt = this.time;
    this.emit({ t: 'dmg', x: p.x, y: p.y - 0.5, v: dmg, c: '#ff5252' });
    this.emit({ t: 'hurt', id: p.id });
    if (p.hp <= 0) {
      p.hp = 0;
      p.downed = true;
      p.revive = 0;
      p.dashT = 0;
      p.shield = 0;
      this.emit({ t: 'down', x: p.x, y: p.y });
      if (this.players.length > 1) this.msg(`${p.name} est à terre ! Allez le relever.`, '#ff8a80');
    }
  }

  // ───────────── Ennemis ─────────────

  spawnEnemy(type, x, y, tier = 0) {
    const d = ENEMIES[type];
    const n = this.partyN();
    let hpMul = (1 + 0.7 * tier) * (1 + (d.boss ? 0.6 : 0.5) * (n - 1));
    if (d.boss && this.players.length === 1) hpMul *= 0.7;
    const hp = Math.round(d.hp * hpMul);
    const e = {
      id: this.newId(), type, x, y, r: d.r, hp, maxHp: hp, dmg: d.dmg * (1 + 0.5 * tier),
      speed: d.speed, xp: Math.round(d.xp * (1 + tier)), boss: !!d.boss,
      state: 'idle', target: null, atkCd: Math.random() * d.atkCd, wind: 0, slowT: 0, flash: 0, aim: Math.random() * TAU,
      homeX: x, homeY: y, tauntId: null, tauntT: 0, wanderT: Math.random() * 3, wdx: 0, wdy: 0,
      chargeT: 0, chargeCd: 2, chargeA: 0, charged: null, busyT: 0, patI: 0, patT: 2.5, queue: [],
      losT: 0, los: false, strafe: Math.random() < 0.5 ? 1 : -1, dead: false, pd: 99,
    };
    this.enemies.push(e);
    return e;
  }

  pickTarget(e) {
    if (e.tauntT > 0) {
      const t = this.player(e.tauntId);
      if (t && !t.downed) return t;
    }
    let best = null, bd = Infinity;
    for (const p of this.players) {
      if (p.downed) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  moveToward(e, tx, ty, mul, dt, useLos = true) {
    const sp = e.speed * mul * (e.slowT > 0 ? 0.45 : 1) * dt;
    let dx = tx - e.x, dy = ty - e.y;
    if (!(useLos && e.los) && this.flow && dist(e.x, e.y, tx, ty) > 1.2) {
      const ix = Math.floor(e.x), iy = Math.floor(e.y);
      const w = this.map.w;
      const cur = this.flow[iy * w + ix];
      if (cur > 0) {
        let bx = ix, by = iy, bv = cur;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const v = this.flow[(iy + oy) * w + ix + ox];
          if (v >= 0 && v < bv) { bv = v; bx = ix + ox; by = iy + oy; }
        }
        dx = bx + 0.5 - e.x; dy = by + 0.5 - e.y;
      }
    }
    const l = Math.hypot(dx, dy);
    if (l < 1e-4) return;
    e.aim = Math.atan2(dy, dx);
    moveCircle(this.map, e, (dx / l) * sp, (dy / l) * sp);
  }

  updateEnemies(dt) {
    const alive = this.players.filter((p) => !p.downed);
    const active = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.flash = Math.max(0, e.flash - dt);
      e.slowT = Math.max(0, e.slowT - dt);
      e.tauntT = Math.max(0, e.tauntT - dt);
      e.atkCd -= dt;
      e.chargeCd -= dt;
      let pd = 99;
      for (const p of this.players) pd = Math.min(pd, dist(p.x, p.y, e.x, e.y));
      e.pd = pd;
      if (pd > 26 && !e.boss) continue;
      active.push(e);
      if (!alive.length) continue;
      const t = this.pickTarget(e);
      if (!t) continue;
      const d = dist(t.x, t.y, e.x, e.y);
      e.losT -= dt;
      if (e.losT <= 0) { e.losT = 0.2; e.los = d < 14 && lineOfSight(this.map, e.x, e.y, t.x, t.y); }
      if (e.state === 'idle') {
        e.calmT = Math.max(0, (e.calmT || 0) - dt);
        if (d < (e.boss ? 9 : 7.5) && e.los && !e.calmT) this.aggro(e, t);
        else { this.wander(e, dt); continue; }
      }
      if (d > 24 && !e.boss) { e.state = 'idle'; continue; }
      // Un ennemi qui n'arrive pas à rejoindre sa cible (eau, lave…) abandonne et rentre.
      if (!e.boss) {
        e.progT = (e.progT || 0) + dt;
        if (e.progT > 2) {
          const moved = Math.hypot(e.x - (e.lastX ?? e.x), e.y - (e.lastY ?? e.y));
          const def0 = ENEMIES[e.type];
          const inRange = def0.ai === 'ranged' ? d <= def0.range && e.los : d < e.r + t.r + (def0.reach || 0) + 0.6;
          e.stuck = !inRange && moved < 0.6 ? (e.stuck || 0) + 1 : 0;
          e.progT = 0; e.lastX = e.x; e.lastY = e.y;
          if (e.stuck >= 2) { e.state = 'idle'; e.calmT = 6; e.stuck = 0; e.wanderT = 0; continue; }
        }
      }
      const def = ENEMIES[e.type];
      if (e.boss) this.bossThink(e, t, d, dt);
      else if (def.ai === 'ranged') this.rangedThink(e, t, d, dt, def);
      else this.meleeThink(e, t, d, dt, def);
    }
    // Les ennemis ne se chevauchent pas.
    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j];
        const d = dist(a.x, a.y, b.x, b.y), m = a.r + b.r;
        if (d < m && d > 1e-4) {
          const push = (m - d) * 0.5;
          const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
          if (!a.boss) moveCircle(this.map, a, -nx * push, -ny * push);
          if (!b.boss) moveCircle(this.map, b, nx * push, ny * push);
        }
      }
    }
    if (this.enemies.some((e) => e.dead)) this.enemies = this.enemies.filter((e) => !e.dead);
  }

  wander(e, dt) {
    e.wanderT -= dt;
    if (e.wanderT <= 0) {
      e.wanderT = 1.5 + Math.random() * 3;
      const a = Math.random() * TAU;
      const home = dist(e.x, e.y, e.homeX, e.homeY) > 3;
      e.wdx = home ? e.homeX - e.x : Math.cos(a);
      e.wdy = home ? e.homeY - e.y : Math.sin(a);
      if (Math.random() < 0.4) { e.wdx = 0; e.wdy = 0; }
    }
    if (e.wanderT > 1 || (!e.wdx && !e.wdy)) return;
    const l = Math.hypot(e.wdx, e.wdy) || 1;
    e.aim = Math.atan2(e.wdy, e.wdx);
    moveCircle(this.map, e, (e.wdx / l) * e.speed * 0.35 * dt, (e.wdy / l) * e.speed * 0.35 * dt);
  }

  meleeThink(e, t, d, dt, def) {
    if (e.chargeT > 0) return this.doCharge(e, dt, 11, 1.4);
    if (e.wind > 0) {
      e.wind -= dt;
      if (e.wind <= 0) {
        if (e.windCharge) { e.windCharge = false; e.chargeT = 0.55; e.charged = new Set(); return; }
        if (d <= e.r + t.r + def.reach + 0.35) { this.hurtPlayer(t, e.dmg); this.emit({ t: 'bite', x: t.x, y: t.y }); }
      }
      return;
    }
    if (def.ai === 'charger' && e.chargeCd <= 0 && d > 3 && d < 8 && e.los) {
      e.chargeCd = 5;
      e.chargeA = Math.atan2(t.y - e.y, t.x - e.x);
      e.aim = e.chargeA;
      e.wind = 0.7;
      e.windCharge = true;
      this.hazards.push({ shape: 'line', x: e.x, y: e.y, a: e.chargeA, len: 7, w: e.r * 2, t: 0.7, dur: 0.7, dmg: 0 });
      return;
    }
    if (d <= e.r + t.r + def.reach) {
      e.aim = Math.atan2(t.y - e.y, t.x - e.x);
      if (e.atkCd <= 0) { e.wind = 0.32; e.atkCd = def.atkCd; }
      return;
    }
    if (def.ai === 'erratic') {
      const a = Math.atan2(t.y - e.y, t.x - e.x) + Math.sin(this.time * 5 + e.id) * 0.9;
      this.moveToward(e, e.x + Math.cos(a) * 2, e.y + Math.sin(a) * 2, 1, dt, e.los);
    } else {
      this.moveToward(e, t.x, t.y, 1, dt);
    }
  }

  doCharge(e, dt, speed, mul) {
    e.chargeT -= dt;
    const hit = moveCircle(this.map, e, Math.cos(e.chargeA) * speed * dt, Math.sin(e.chargeA) * speed * dt);
    for (const p of this.players) {
      if (p.downed || e.charged.has(p.id)) continue;
      if (dist(p.x, p.y, e.x, e.y) < e.r + p.r + 0.15) {
        e.charged.add(p.id);
        this.hurtPlayer(p, e.dmg * mul);
        moveCircle(this.map, p, Math.cos(e.chargeA) * 1.2, Math.sin(e.chargeA) * 1.2);
      }
    }
    if (hit) { e.chargeT = 0; this.emit({ t: 'boom', x: e.x, y: e.y, r: 1, c: '#bcaaa4' }); }
  }

  rangedThink(e, t, d, dt, def) {
    if (e.wind > 0) {
      e.wind -= dt;
      if (e.wind <= 0) {
        const a = Math.atan2(t.y - e.y, t.x - e.x);
        const n = def.spread || 1;
        for (let k = 0; k < n; k++) this.shoot(e, def.proj, a + (k - (n - 1) / 2) * 0.22, def.pspeed, e.dmg, 1.6);
      }
      return;
    }
    if (d > def.range || !e.los) this.moveToward(e, t.x, t.y, 1, dt);
    else if (d < 3.2) this.moveToward(e, e.x * 2 - t.x, e.y * 2 - t.y, 0.8, dt);
    else {
      const a = Math.atan2(t.y - e.y, t.x - e.x) + (Math.PI / 2) * e.strafe;
      if (moveCircle(this.map, e, Math.cos(a) * e.speed * 0.35 * dt, Math.sin(a) * e.speed * 0.35 * dt)) e.strafe *= -1;
      if (Math.random() < dt * 0.4) e.strafe *= -1;
    }
    e.aim = Math.atan2(t.y - e.y, t.x - e.x);
    if (e.los && d <= def.range + 1 && e.atkCd <= 0) { e.wind = 0.4; e.atkCd = def.atkCd; }
  }

  bossThink(e, t, d, dt) {
    const def = ENEMIES[e.type];
    const enraged = e.hp < e.maxHp * 0.4;
    for (const q of e.queue) { q.t -= dt; if (q.t <= 0) q.fn(); }
    e.queue = e.queue.filter((q) => q.t > 0);
    if (e.chargeT > 0) return this.doCharge(e, dt, 13, 1.3);
    if (e.wind > 0) {
      e.wind -= dt;
      if (e.wind <= 0) {
        if (e.windCharge) { e.windCharge = false; e.chargeT = 0.75; e.charged = new Set(); return; }
        if (d <= e.r + t.r + def.reach + 0.5) { this.hurtPlayer(t, e.dmg); this.emit({ t: 'bite', x: t.x, y: t.y }); }
      }
      return;
    }
    e.patT -= dt * (enraged ? 1.45 : 1);
    if (e.patT <= 0) {
      const pat = def.patterns[e.patI++ % def.patterns.length];
      e.patT = 3.4;
      this.bossPattern(e, pat, t, enraged);
      return;
    }
    if (e.busyT > 0) { e.busyT -= dt; return; }
    if (d <= e.r + t.r + def.reach) {
      e.aim = Math.atan2(t.y - e.y, t.x - e.x);
      if (e.atkCd <= 0) { e.wind = 0.45; e.atkCd = def.atkCd; }
    } else {
      this.moveToward(e, t.x, t.y, enraged ? 1.25 : 1, dt);
    }
  }

  bossPattern(e, pat, t, enraged) {
    const def = ENEMIES[e.type];
    const alive = this.players.filter((p) => !p.downed);
    if (pat === 'ring') {
      const n = 18;
      const fire = (off) => () => {
        for (let k = 0; k < n; k++) this.shoot(e, def.proj, (k / n) * TAU + off, 6.5, e.dmg * 0.7, 3);
      };
      this.emit({ t: 'charge', x: e.x, y: e.y, r: e.r + 0.6, c: def.color });
      e.queue.push({ t: 0.6, fn: fire(0) });
      if (enraged) e.queue.push({ t: 1.2, fn: fire(Math.PI / n) });
      e.busyT = 1.2;
    } else if (pat === 'summon') {
      const adds = this.enemies.filter((o) => !o.dead && !o.boss).length;
      const n = Math.min(8 - adds, this.players.length === 1 ? 2 : 2 + Math.round(this.partyN()));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        const x = e.x + Math.cos(a) * (e.r + 1.2), y = e.y + Math.sin(a) * (e.r + 1.2);
        if (collides(this.map, x, y, 0.4)) continue;
        const m = this.spawnEnemy(def.adds[k % def.adds.length], x, y, this.map.dungeon * 0.5);
        m.state = 'chase';
        this.emit({ t: 'die', x, y, r: 0.5, c: '#b388ff' });
      }
      e.busyT = 0.6;
    } else if (pat === 'charge') {
      e.chargeA = Math.atan2(t.y - e.y, t.x - e.x);
      e.aim = e.chargeA;
      e.wind = 0.85;
      e.windCharge = true;
      this.hazards.push({ shape: 'line', x: e.x, y: e.y, a: e.chargeA, len: 10, w: e.r * 2, t: 0.85, dur: 0.85, dmg: 0 });
    } else if (pat === 'slam') {
      for (const p of alive) this.hazards.push({ shape: 'circle', x: p.x, y: p.y, r: 2.1, t: 1.2, dur: 1.2, dmg: e.dmg * 1.4, c: def.color });
      this.hazards.push({ shape: 'circle', x: e.x, y: e.y, r: e.r + 2.4, t: 1.0, dur: 1.0, dmg: e.dmg * 1.2, c: def.color });
      e.busyT = 1.3;
    } else if (pat === 'spiral') {
      const arms = enraged ? 4 : 3;
      for (let s = 0; s < 18; s++) {
        e.queue.push({
          t: 0.3 + s * 0.11,
          fn: () => { for (let k = 0; k < arms; k++) this.shoot(e, def.proj, s * 0.33 + (k / arms) * TAU, 7, e.dmg * 0.6, 3); },
        });
      }
      e.busyT = 2.2;
    } else if (pat === 'breath') {
      const a = Math.atan2(t.y - e.y, t.x - e.x);
      e.aim = a;
      this.hazards.push({ shape: 'cone', x: e.x, y: e.y, a, arc: 1.0, r: 8.5, t: 1.1, dur: 1.1, dmg: e.dmg * 1.7, c: '#ff7043' });
      e.busyT = 1.6;
    } else if (pat === 'meteor') {
      for (let k = 0; k < 7; k++) {
        const p = alive[k % Math.max(1, alive.length)] || t;
        const x = p.x + (Math.random() - 0.5) * 6, y = p.y + (Math.random() - 0.5) * 6;
        const delay = 1.3 + k * 0.15;
        this.hazards.push({ shape: 'circle', x: k < alive.length ? p.x : x, y: k < alive.length ? p.y : y, r: 1.8, t: delay, dur: delay, dmg: e.dmg * 1.3, c: '#ff7043' });
      }
      e.busyT = 0.8;
    }
  }

  // ───────────── Projectiles & zones ─────────────

  updateProjs(dt) {
    const keep = [];
    for (const pr of this.projs) {
      pr.life -= dt;
      let gone = pr.life <= 0;
      const steps = Math.max(1, Math.ceil((Math.hypot(pr.vx, pr.vy) * dt) / 0.15));
      for (let s = 0; s < steps && !gone; s++) {
        pr.x += (pr.vx * dt) / steps;
        pr.y += (pr.vy * dt) / steps;
        if (BLOCK_SHOT[this.map.get(Math.floor(pr.x), Math.floor(pr.y))]) { gone = true; break; }
        if (pr.side === 'p') {
          for (const e of this.enemies) {
            if (e.dead || (pr.hits && pr.hits.has(e.id))) continue;
            if (dist(pr.x, pr.y, e.x, e.y) < e.r + pr.r) {
              if (pr.aoe) { gone = true; break; }
              this.hurtEnemy(e, pr.dmg, this.player(pr.owner));
              this.emit({ t: 'hit', x: pr.x, y: pr.y, c: '#fff' });
              if (pr.pierce > 0) { pr.pierce--; (pr.hits ||= new Set()).add(e.id); } else { gone = true; break; }
            }
          }
        } else {
          for (const p of this.players) {
            if (p.downed || p.invT > 0) continue;
            if (dist(pr.x, pr.y, p.x, p.y) < p.r + pr.r) {
              this.hurtPlayer(p, pr.dmg);
              this.emit({ t: 'hit', x: pr.x, y: pr.y, c: '#ff8a80' });
              gone = true;
              break;
            }
          }
        }
      }
      if (gone) {
        if (pr.aoe) this.explode(pr);
      } else keep.push(pr);
    }
    this.projs = keep;
  }

  explode(pr) {
    this.emit({ t: 'boom', x: pr.x, y: pr.y, r: pr.aoe, c: '#ff8f00' });
    const src = this.player(pr.owner);
    for (const e of this.enemies) {
      if (!e.dead && dist(pr.x, pr.y, e.x, e.y) < pr.aoe + e.r) this.hurtEnemy(e, pr.dmg, src);
    }
  }

  updateHazards(dt) {
    const keep = [];
    for (const h of this.hazards) {
      h.t -= dt;
      if (h.t > 0) { keep.push(h); continue; }
      if (!h.dmg) continue;
      this.emit({ t: 'boom', x: h.x, y: h.y, r: h.shape === 'circle' ? h.r : 1.5, c: h.c || '#ff7043', cone: h.shape === 'cone' ? [h.a, h.arc, h.r] : null });
      for (const p of this.players) {
        if (p.downed) continue;
        const d = dist(p.x, p.y, h.x, h.y);
        let inside = false;
        if (h.shape === 'circle') inside = d < h.r + p.r * 0.5;
        else if (h.shape === 'cone') inside = d < h.r && Math.abs(angleDiff(h.a, Math.atan2(p.y - h.y, p.x - h.x))) < h.arc / 2 + 0.05;
        if (inside) this.hurtPlayer(p, h.dmg);
      }
    }
    this.hazards = keep;
  }

  // ───────────── Objets ─────────────

  drop(type, x, y) {
    for (let k = 0; k < 8; k++) {
      const nx = x + (Math.random() - 0.5) * 1.8, ny = y + (Math.random() - 0.5) * 1.8;
      if (!collides(this.map, nx, ny, 0.2)) { x = nx; y = ny; break; }
    }
    this.items.push({ id: this.newId(), type, x, y });
  }

  updateItems() {
    if (!this.items.length) return;
    const keep = [];
    for (const it of this.items) {
      let taken = false;
      for (const p of this.players) {
        if (p.downed) continue;
        const d = dist(p.x, p.y, it.x, it.y);
        if (it.type === 'chest' || it.type === 'bigchest') {
          if (d < 0.95) { this.openChest(it); taken = true; break; }
          continue;
        }
        if (p.bot || d > 0.7) continue;
        if (it.type === 'potion') {
          if (p.potions >= MAX_POTIONS) continue;
          p.potions++;
          this.emit({ t: 'dmg', x: p.x, y: p.y - 0.6, v: '+1 potion', c: '#ef9a9a' });
        } else if (it.type === 'gem') {
          p.gems++;
          this.recalc(p);
          this.emit({ t: 'dmg', x: p.x, y: p.y - 0.6, v: '+6 % dégâts', c: '#ce93d8' });
        } else if (it.type === 'heart') {
          p.hearts++;
          this.recalc(p);
          this.heal(p, 12);
          this.emit({ t: 'dmg', x: p.x, y: p.y - 0.6, v: '+12 PV max', c: '#f48fb1' });
        }
        this.emit({ t: 'pick', x: it.x, y: it.y });
        taken = true;
        break;
      }
      if (!taken) keep.push(it);
    }
    this.items = keep;
  }

  openChest(it) {
    this.emit({ t: 'chest', x: it.x, y: it.y });
    if (it.type === 'bigchest') {
      for (const p of this.humans()) { this.drop('gem', it.x, it.y); this.drop('heart', it.x, it.y); }
      this.drop('potion', it.x, it.y);
      this.drop('potion', it.x, it.y);
      return;
    }
    const n = 2 + (Math.random() < 0.3 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const r = Math.random();
      this.drop(r < 0.5 ? 'potion' : r < 0.75 ? 'gem' : 'heart', it.x, it.y);
    }
  }

  // ───────────── Groupe : réanimation, défaite, sorties ─────────────

  updateParty(dt) {
    for (const p of this.players) {
      if (!p.downed) continue;
      let rate = 0;
      for (const q of this.players) {
        if (q === p || q.downed) continue;
        if (dist(p.x, p.y, q.x, q.y) < 1.7) rate = Math.max(rate, q.cls === 'clerc' ? 1 / 1.5 : 1 / 3);
      }
      if (rate) {
        p.revive += rate * dt;
        if (p.revive >= 1) {
          p.downed = false;
          p.revive = 0;
          p.hp = Math.round(p.maxHp * 0.4);
          p.invT = 1.5;
          this.emit({ t: 'lvl', x: p.x, y: p.y });
          this.msg(`${p.name} est relevé !`, '#b9f6ca');
        }
      } else p.revive = Math.max(0, p.revive - dt * 0.15);
    }
    if (this.players.length && this.players.every((p) => p.downed)) {
      this.wipeT += dt;
      if (this.wipeT >= 3) this.respawnParty();
    } else this.wipeT = 0;
    this.updateExits(dt);
  }

  respawnParty() {
    this.wipeT = 0;
    this.projs.length = 0;
    this.hazards.length = 0;
    for (const e of this.enemies) {
      e.state = 'idle'; e.x = e.homeX; e.y = e.homeY; e.wind = 0; e.chargeT = 0; e.queue = []; e.busyT = 0;
      if (e.boss) { e.hp = e.maxHp; e.patI = 0; e.patT = 2.5; }
    }
    this.players.forEach((p, i) => {
      p.downed = false; p.revive = 0; p.hp = Math.round(p.maxHp * 0.6); p.invT = 2;
      this.placePlayer(p, this.spawnPoint, i);
    });
    this.msg('Le groupe se relève au point de départ…', '#ffcc80');
  }

  updateExits(dt) {
    this.gather = null;
    if (this.mapAge < 1) return;
    const humans = this.humans();
    if (!humans.length) return;
    const exits = this.portal ? [...this.map.exits, this.portal] : this.map.exits;
    for (const ex of exits) {
      const cx = ex.x + 0.5, cy = ex.y + 0.5;
      if (!humans.some((p) => !p.downed && dist(p.x, p.y, cx, cy) < (ex.kind === 'exit' ? 1.0 : 1.3))) continue;
      if (ex.kind === 'entrance' && ex.dungeon > 0 && !this.cleared[ex.dungeon - 1]) {
        this.gather = { label: `Scellé — terminez d’abord : ${DUNGEONS[ex.dungeon - 1].name}`, locked: true };
        this.gatherT = 0;
        return;
      }
      const near = humans.filter((p) => !p.downed && dist(p.x, p.y, cx, cy) < 2.8).length;
      // Remonter à la surface demande de rester un peu plus longtemps : on évite les sorties accidentelles.
      const hold = ex.kind === 'exit' ? 1.6 : 0.8;
      this.gather = { label: exitLabel(ex), n: near, total: humans.length, p: Math.min(1, this.gatherT / hold) };
      if (near === humans.length) {
        this.gatherT += dt;
        if (this.gatherT > hold) {
          this.gatherT = 0;
          const from = ex.kind === 'exit' || ex.kind === 'portal' ? ex.dungeon : null;
          this.loadMap(ex.target, from);
        }
      } else this.gatherT = 0;
      return;
    }
    this.gatherT = 0;
  }

  // ───────────── Réseau ─────────────

  snapshot() {
    const P = this.players.map((p) => ({
      i: p.id, n: p.name, c: p.cls, b: p.bot ? 1 : 0, x: r2(p.x), y: r2(p.y), a: r2(p.aim),
      h: Math.ceil(p.hp), m: p.maxHp, l: p.level, xp: Math.floor(p.xp), d: p.downed ? 1 : 0, rv: r2(p.revive),
      s: Math.ceil(p.shield), g: r2(p.guardT), iv: r2(p.invT), cd: p.cd.map(r2), po: p.potions,
      ge: p.gems, he: p.hearts, k: p.ack, f: p.dashT > 0 || p.downed ? 1 : 0,
    }));
    const near = (x, y) => this.players.some((p) => Math.abs(p.x - x) < 30 && Math.abs(p.y - y) < 22);
    const E = [];
    for (const e of this.enemies) {
      if (!e.boss && !near(e.x, e.y)) continue;
      const flags = (e.flash > 0 ? 1 : 0) | (e.slowT > 0 ? 2 : 0) | (e.wind > 0 ? 4 : 0) | (e.state === 'idle' ? 8 : 0) | (e.chargeT > 0 ? 16 : 0);
      E.push([e.id, ENEMY_IDS.indexOf(e.type), r2(e.x), r2(e.y), Math.max(0, Math.ceil(e.hp)), e.maxHp, flags, r2(e.aim)]);
    }
    const R = this.projs.map((p) => [r2(p.x), r2(p.y), r2(p.vx), r2(p.vy), PROJ_IDS.indexOf(p.type), p.side === 'p' ? 1 : 0, p.r]);
    const I = this.items.map((it) => [it.id, ITEM_IDS.indexOf(it.type), r2(it.x), r2(it.y)]);
    const H = this.hazards.map((h) => [r2(h.x), r2(h.y), r2(h.r || 0), r2(h.t), r2(h.dur), SHAPES[h.shape], r2(h.a || 0), r2(h.arc || 0), r2(h.len || 0), r2(h.w || 0), h.c || '']);
    return {
      t: 'snap', k: this.tick, P, E, R, I, H,
      G: { m: this.mapId, cl: this.cleared, ga: this.gather, w: r2(this.wipeT), po: this.portal, v: this.victory ? 1 : 0 },
    };
  }

  view() {
    return {
      mapId: this.mapId, players: this.players, enemies: this.enemies, projs: this.projs, items: this.items,
      hazards: this.hazards, gather: this.gather, wipeT: this.wipeT, portal: this.portal, cleared: this.cleared,
      victory: this.victory,
    };
  }
}
