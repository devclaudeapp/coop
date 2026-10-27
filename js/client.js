// État côté client : reçoit les instantanés de l'hôte, interpole les autres entités
// et prédit le déplacement du joueur local pour qu'il reste réactif malgré la latence.

import { ENEMY_IDS, ENEMIES, ITEM_IDS, PROJ_IDS } from './data.js';
import { generateMap } from './mapgen.js';
import { stepPlayerMove, PLAYER_R } from './sim.js';
import { lerp, lerpAngle } from './util.js';

const TICK = 1 / 60;
const DELAY = 0.1;
const SHAPES = ['circle', 'cone', 'line'];

function decodePlayer(o) {
  return {
    id: o.i, name: o.n, cls: o.c, bot: !!o.b, x: o.x, y: o.y, aim: o.a, hp: o.h, maxHp: o.m, level: o.l, xp: o.xp,
    downed: !!o.d, revive: o.rv, shield: o.s, guardT: o.g, invT: o.iv, cd: o.cd, potions: o.po, gems: o.ge,
    hearts: o.he, ack: o.k, forced: !!o.f, r: PLAYER_R,
  };
}

function decodeEnemy(a) {
  const type = ENEMY_IDS[a[1]];
  const def = ENEMIES[type];
  return {
    id: a[0], type, x: a[2], y: a[3], hp: a[4], maxHp: a[5], flash: a[6] & 1 ? 0.1 : 0, slowT: a[6] & 2 ? 1 : 0,
    wind: a[6] & 4 ? 1 : 0, state: a[6] & 8 ? 'idle' : 'chase', chargeT: a[6] & 16 ? 1 : 0, aim: a[7], r: def.r, boss: !!def.boss,
  };
}

export class ClientGame {
  constructor({ worldSeed, you }) {
    this.worldSeed = worldSeed;
    this.you = you;
    this.map = null;
    this.mapId = null;
    this.snaps = [];
    this.clock = 0;
    this.seq = 0;
    this.pending = [];
    this.out = [];
    this.pred = null;
    this.offX = 0;
    this.offY = 0;
    this.forced = false;
    this.fx = [];
    this.me = null;
  }

  onSnap(s) {
    const serverTime = s.k * TICK;
    if (s.G.m !== this.mapId) {
      this.mapId = s.G.m;
      this.map = generateMap(this.worldSeed, this.mapId);
      this.snaps = [];
      this.pred = null;
      this.pending = [];
    }
    if (this.snaps.length && serverTime <= this.snaps[this.snaps.length - 1].time) return;
    const snap = {
      time: serverTime,
      players: s.P.map(decodePlayer),
      enemies: s.E.map(decodeEnemy),
      projs: s.R.map((a) => ({ x: a[0], y: a[1], vx: a[2], vy: a[3], type: PROJ_IDS[a[4]], side: a[5] ? 'p' : 'e', r: a[6] })),
      items: s.I.map((a) => ({ id: a[0], type: ITEM_IDS[a[1]], x: a[2], y: a[3] })),
      hazards: s.H.map((a) => ({ x: a[0], y: a[1], r: a[2], t: a[3], dur: a[4], shape: SHAPES[a[5]], a: a[6], arc: a[7], len: a[8], w: a[9], c: a[10] })),
      meta: s.G,
    };
    this.snaps.push(snap);
    if (this.snaps.length > 12) this.snaps.shift();
    if (!this.clock || Math.abs(this.clock - serverTime) > 0.5) this.clock = serverTime;
    this.latest = snap;
    this.latestRecv = performance.now() / 1000;
    if (s.F && s.F.length) this.fx.push(...s.F);
    this.reconcile(snap);
  }

  reconcile(snap) {
    const me = snap.players.find((p) => p.id === this.you);
    this.me = me;
    if (!me) return;
    this.forced = me.forced;
    const old = this.pred ? { x: this.pred.x + this.offX, y: this.pred.y + this.offY } : null;
    this.pred = { x: me.x, y: me.y, r: PLAYER_R, cls: me.cls };
    this.pending = this.pending.filter((f) => f[0] > me.ack);
    if (!me.forced) for (const f of this.pending) stepPlayerMove(this.map, this.pred, f[1], f[2], Math.min(f[3], 0.1));
    if (old && !me.forced) {
      this.offX = old.x - this.pred.x;
      this.offY = old.y - this.pred.y;
      if (Math.hypot(this.offX, this.offY) > 2) { this.offX = 0; this.offY = 0; }
    } else { this.offX = 0; this.offY = 0; }
  }

  // Applique l'entrée locale immédiatement (prédiction) et la met en file pour l'hôte.
  predict(mx, my, dt) {
    if (!this.pred || !this.map) return;
    const f = [++this.seq, Math.round(mx * 1000) / 1000, Math.round(my * 1000) / 1000, Math.round(dt * 10000) / 10000];
    this.out.push(f);
    if (this.me && this.me.downed) return;
    this.pending.push(f);
    if (!this.forced) stepPlayerMove(this.map, this.pred, f[1], f[2], Math.min(f[3], 0.1));
    const decay = Math.exp(-dt * 12);
    this.offX *= decay;
    this.offY *= decay;
  }

  takeOutgoing() { const o = this.out; this.out = []; return o; }
  drainFx() { const f = this.fx; this.fx = []; return f; }

  view(dt, aim) {
    if (!this.latest) return null;
    const now = performance.now() / 1000;
    const target = this.latest.time + (now - this.latestRecv);
    this.clock += dt;
    this.clock += (target - this.clock) * 0.1;
    const rt = this.clock - DELAY;
    let a = this.snaps[0], b = this.snaps[0];
    for (let i = 0; i < this.snaps.length; i++) {
      if (this.snaps[i].time <= rt) a = this.snaps[i];
      if (this.snaps[i].time >= rt) { b = this.snaps[i]; break; }
      b = this.snaps[i];
    }
    const span = b.time - a.time;
    const t = span > 0 ? Math.min(1, Math.max(0, (rt - a.time) / span)) : 1;

    const interp = (listA, listB, extra) => {
      const byId = new Map(listA.map((e) => [e.id, e]));
      return listB.map((eb) => {
        const ea = byId.get(eb.id);
        if (!ea) return eb;
        const o = { ...eb, x: lerp(ea.x, eb.x, t), y: lerp(ea.y, eb.y, t), aim: lerpAngle(ea.aim, eb.aim, t) };
        if (extra) extra(o, ea, eb);
        return o;
      });
    };
    const players = interp(a.players, b.players);
    const me = this.latest.players.find((p) => p.id === this.you);
    if (me && this.pred) {
      const i = players.findIndex((p) => p.id === this.you);
      const mine = { ...me, x: this.pred.x + this.offX, y: this.pred.y + this.offY, aim: me.downed ? me.aim : aim };
      if (me.forced) { mine.x = me.x; mine.y = me.y; this.pred.x = me.x; this.pred.y = me.y; }
      if (i >= 0) players[i] = mine; else players.push(mine);
    }
    const enemies = interp(a.enemies, b.enemies);
    const age = rt - a.time;
    const projs = a.projs.map((p) => ({ ...p, x: p.x + p.vx * age, y: p.y + p.vy * age }));
    const late = Math.max(0, now - this.latestRecv);
    const hazards = this.latest.hazards.map((h) => ({ ...h, t: Math.max(0, h.t - late) }));
    const m = this.latest.meta;
    return {
      mapId: this.mapId, players, enemies, projs, items: b.items, hazards, gather: m.ga, wipeT: m.w, portal: m.po,
      cleared: m.cl, victory: !!m.v,
    };
  }
}
