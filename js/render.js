// Rendu Canvas 2D : tuiles, entités, effets, lumière des donjons, brouillard, minicarte et interface.
// Tout est dessiné en formes vectorielles : aucun fichier image n'est nécessaire.

import { T, CLASSES, ENEMIES, DUNGEONS, THEMES, xpForLevel, mapName } from './data.js';
import { clamp, hash2, TAU, lerp } from './util.js';

const GRASS = ['#4b7d3f', '#477a3b', '#4f8443', '#4a7f40'];
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.fog = {};
    this.particles = [];
    this.texts = [];
    this.rings = [];
    this.swings = [];
    this.toasts = [];
    this.anim = new Map();
    this.shake = 0;
    this.hurtFlash = 0;
    this.bossBanner = 0;
    this.victoryT = 0;
    this.time = 0;
    this.camX = 0;
    this.camY = 0;
    this.touchButtons = [];
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = this.canvas.width = Math.round(innerWidth * this.dpr);
    this.H = this.canvas.height = Math.round(innerHeight * this.dpr);
    this.ts = Math.round(clamp(Math.min(this.W, this.H) / 16.5, 24, 60));
    this.u = this.dpr * clamp(Math.min(innerWidth, innerHeight) / 760, 0.72, 1.25);
    this.light.width = Math.ceil(this.W / 4);
    this.light.height = Math.ceil(this.H / 4);
  }

  setMap(map) {
    this.map = map;
    if (!this.fog[map.id] || this.fog[map.id].length !== map.w * map.h) this.fog[map.id] = new Uint8Array(map.w * map.h);
    this.explored = this.fog[map.id];
    this.mini = document.createElement('canvas');
    this.mini.width = map.w;
    this.mini.height = map.h;
    this.mctx = this.mini.getContext('2d');
    this.mimg = this.mctx.createImageData(map.w, map.h);
    for (let i = 0; i < map.w * map.h; i++) if (this.explored[i]) this.paintMini(i);
    this.mctx.putImageData(this.mimg, 0, 0);
    this.particles.length = 0;
    this.rings.length = 0;
    this.swings.length = 0;
    this.texts.length = 0;
    this.anim.clear();
  }

  tileColor(i) {
    const t = this.map.tiles[i];
    if (this.map.kind === 'world') {
      switch (t) {
        case T.TREE: return [36, 70, 33];
        case T.WATER: return [47, 110, 165];
        case T.PATH: return [180, 154, 104];
        case T.BRIDGE: return [141, 110, 74];
        case T.HOUSE: return [160, 70, 55];
        case T.FOUNTAIN: return [144, 202, 249];
        case T.ENTRANCE: return [255, 213, 79];
        case T.ROCK: return [120, 120, 120];
        default: return [75, 125, 63];
      }
    }
    const th = THEMES[this.map.theme];
    if (t === T.WALL) return this.nearOpen(i % this.map.w, (i / this.map.w) | 0) ? hex(th.wallTop) : null;
    if (t === T.STAIRS || t === T.EXIT) return [255, 213, 79];
    if (t === T.LAVA) return [255, 112, 67];
    if (t === T.PILLAR || t === T.CRYSTAL) return hex(th.wallTop);
    return hex(th.floor).map((v) => Math.min(255, v + 25));
  }

  paintMini(i) {
    const c = this.tileColor(i);
    const d = this.mimg.data;
    if (!c) { d[i * 4 + 3] = 0; return; }
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
  }

  nearOpen(x, y) {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const t = this.map.get(x + ox, y + oy);
      if (t !== T.WALL && t !== T.VOID) return true;
    }
    return false;
  }

  reveal(view) {
    const map = this.map;
    const R = map.kind === 'world' ? 11 : 7;
    let dirty = false;
    for (const p of view.players) {
      const cx = Math.floor(p.x), cy = Math.floor(p.y);
      for (let y = cy - R; y <= cy + R; y++) {
        if (y < 0 || y >= map.h) continue;
        for (let x = cx - R; x <= cx + R; x++) {
          if (x < 0 || x >= map.w || (x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
          const i = y * map.w + x;
          if (!this.explored[i]) { this.explored[i] = 1; this.paintMini(i); dirty = true; }
        }
      }
    }
    if (dirty) this.mctx.putImageData(this.mimg, 0, 0);
  }

  // ───────────── Effets ─────────────

  addFx(list, meId) {
    for (const ev of list) {
      switch (ev.t) {
        case 'dmg': this.texts.push({ x: ev.x + (Math.random() - 0.5) * 0.3, y: ev.y, v: String(ev.v), c: ev.c, life: 0.9 }); break;
        case 'msg': this.toast(ev.text, ev.c); break;
        case 'swing': this.swings.push({ ...ev, life: 0.16, max: 0.16 }); break;
        case 'spin': this.rings.push({ x: ev.x, y: ev.y, r0: 0.4, r1: ev.r, c: ev.c, life: 0.3, max: 0.3, w: 0.35, fill: true }); break;
        case 'nova': this.rings.push({ x: ev.x, y: ev.y, r0: 0.3, r1: ev.r, c: ev.c, life: 0.45, max: 0.45, w: 0.15, fill: true }); break;
        case 'charge': this.rings.push({ x: ev.x, y: ev.y, r0: ev.r + 1.5, r1: ev.r, c: ev.c, life: 0.6, max: 0.6, w: 0.12 }); break;
        case 'dash': this.burst(ev.x, ev.y, ev.c, 10, 2, 0.35); break;
        case 'boom':
          if (ev.cone) this.swings.push({ x: ev.x, y: ev.y, a: ev.cone[0], arc: ev.cone[1], r: ev.cone[2], c: ev.c, life: 0.35, max: 0.35 });
          else this.rings.push({ x: ev.x, y: ev.y, r0: ev.r * 0.3, r1: ev.r, c: ev.c, life: 0.35, max: 0.35, w: 0.3, fill: true, light: true });
          this.burst(ev.x, ev.y, ev.c, 18, 5, 0.5);
          this.shake = Math.max(this.shake, 0.18);
          break;
        case 'die': this.burst(ev.x, ev.y, ev.c, 16, 4, 0.6); break;
        case 'hit': this.burst(ev.x, ev.y, ev.c, 4, 3, 0.2); break;
        case 'bite': this.burst(ev.x, ev.y, '#ff5252', 6, 3, 0.3); break;
        case 'heal': for (let k = 0; k < 5; k++) this.particles.push({ x: ev.x + (Math.random() - 0.5) * 0.8, y: ev.y + 0.2, vx: 0, vy: -1.2 - Math.random(), life: 0.8, max: 0.8, c: '#69f0ae', size: 0.08, plus: true }); break;
        case 'lvl':
          this.rings.push({ x: ev.x, y: ev.y, r0: 0.2, r1: 2, c: '#ffd54f', life: 0.7, max: 0.7, w: 0.15 });
          this.burst(ev.x, ev.y, '#ffd54f', 20, 3, 0.8);
          break;
        case 'chest': this.burst(ev.x, ev.y, '#ffd54f', 24, 4, 0.7); break;
        case 'pick': this.burst(ev.x, ev.y, '#fff9c4', 8, 2, 0.4); break;
        case 'down': this.burst(ev.x, ev.y, '#9e9e9e', 12, 3, 0.5); break;
        case 'hurt': {
          const a = this.anim.get(ev.id);
          if (a) a.hurt = 0.15;
          if (ev.id === meId) { this.hurtFlash = 0.35; this.shake = Math.max(this.shake, 0.12); }
          break;
        }
        case 'boss': this.bossBanner = 3; break;
        case 'victory': this.victoryT = 8; break;
      }
    }
  }

  toast(text, c = '#fff') {
    if (this.toasts.some((t) => t.text === text && t.life > 2)) return;
    this.toasts.push({ text, c, life: 4 });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  burst(x, y, c, n, speed, life) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU, s = Math.random() * speed;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.5 + Math.random() * 0.5), max: life, c, size: 0.05 + Math.random() * 0.06 });
    }
  }

  // ───────────── Image principale ─────────────

  screenPos(x, y) {
    return [(x * this.ts + this.ox) / this.dpr, (y * this.ts + this.oy) / this.dpr];
  }

  draw(view, meId, dt, ui) {
    this.time += dt;
    const { ctx, W, H, ts: s } = this;
    const map = this.map;
    const me = view.players.find((p) => p.id === meId) || view.players[0];
    if (me) { this.camX = me.x; this.camY = me.y; }
    this.reveal(view);
    let shx = 0, shy = 0;
    if (this.shake > 0) { this.shake -= dt; shx = (Math.random() - 0.5) * s * 0.25; shy = (Math.random() - 0.5) * s * 0.25; }
    this.ox = Math.round(W / 2 - this.camX * s + shx);
    this.oy = Math.round(H / 2 - this.camY * s + shy);
    const x0 = Math.floor(-this.ox / s) - 1, y0 = Math.floor(-this.oy / s) - 1;
    const x1 = Math.ceil((W - this.ox) / s) + 1, y1 = Math.ceil((H - this.oy) / s) + 1;

    ctx.fillStyle = map.kind === 'world' ? '#1d3319' : '#07060a';
    ctx.fillRect(0, 0, W, H);
    this.drawTiles(x0, y0, x1, y1);
    this.drawExitsGlow(view);
    for (const h of view.hazards) this.drawHazard(h);
    this.drawSwings(dt);

    // Entités triées par profondeur.
    const ents = [];
    for (const it of view.items) ents.push([it.y - 0.2, 0, it]);
    for (const e of view.enemies) ents.push([e.y, 1, e]);
    for (const p of view.players) ents.push([p.y, 2, p]);
    ents.sort((a, b) => a[0] - b[0]);
    for (const [, k, o] of ents) {
      if (k === 0) this.drawItem(o);
      else if (k === 1) this.drawEnemy(o, dt);
      else this.drawPlayer(o, o.id === meId, dt);
    }
    for (const p of view.projs) this.drawProj(p);
    this.drawParticles(dt);

    if (map.kind === 'dungeon') this.drawDarkness(view);
    this.drawFog(x0, y0, x1, y1);
    this.drawTexts(dt);
    this.drawHud(view, me, dt, ui);
  }

  X(x) { return x * this.ts + this.ox; }
  Y(y) { return y * this.ts + this.oy; }

  drawTiles(x0, y0, x1, y1) {
    const { ctx, ts: s, map } = this;
    const world = map.kind === 'world';
    const th = THEMES[map.theme];
    const over = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = map.get(x, y);
        const sx = x * s + this.ox, sy = y * s + this.oy;
        const h = hash2(x, y, 7);
        if (world) {
          if (t === T.VOID) continue;
          if (t === T.WATER || t === T.BRIDGE) {
            ctx.fillStyle = '#2f6ea5';
            ctx.fillRect(sx, sy, s, s);
            const above = map.get(x, y - 1);
            if (above !== T.WATER && above !== T.BRIDGE) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(sx, sy, s, s * 0.08); }
            ctx.strokeStyle = 'rgba(255,255,255,0.13)';
            ctx.lineWidth = s * 0.04;
            const wv = Math.sin(this.time * 1.5 + x * 0.9 + y * 0.6) * s * 0.12;
            ctx.beginPath(); ctx.moveTo(sx + s * 0.2 + wv, sy + s * 0.5); ctx.lineTo(sx + s * 0.55 + wv, sy + s * 0.5); ctx.stroke();
            if (t === T.BRIDGE) {
              ctx.fillStyle = '#8d6e4a';
              ctx.fillRect(sx, sy + s * 0.05, s, s * 0.9);
              ctx.fillStyle = '#6d5236';
              for (let k = 1; k < 4; k++) ctx.fillRect(sx + (k * s) / 4 - s * 0.02, sy + s * 0.05, s * 0.04, s * 0.9);
            }
            continue;
          }
          if (t === T.PATH || t === T.FOUNTAIN) {
            ctx.fillStyle = h < 0.5 ? '#b49a68' : '#ae9462';
            ctx.fillRect(sx, sy, s, s);
            if (h > 0.8) { ctx.fillStyle = 'rgba(80,60,30,0.25)'; ctx.fillRect(sx + h * s * 0.6, sy + s * 0.4, s * 0.08, s * 0.08); }
            if (t === T.FOUNTAIN) over.push([t, x, y, sx, sy, h]);
            continue;
          }
          ctx.fillStyle = GRASS[(h * 4) | 0];
          ctx.fillRect(sx, sy, s, s);
          if (h < 0.18) {
            ctx.strokeStyle = 'rgba(30,70,30,0.5)'; ctx.lineWidth = s * 0.03;
            ctx.beginPath(); ctx.moveTo(sx + s * 0.3, sy + s * 0.7); ctx.lineTo(sx + s * 0.34, sy + s * 0.55);
            ctx.moveTo(sx + s * 0.4, sy + s * 0.72); ctx.lineTo(sx + s * 0.42, sy + s * 0.58); ctx.stroke();
          }
          if (t === T.FLOWER) {
            const cols = ['#fff59d', '#f48fb1', '#e1f5fe', '#ffcc80'];
            for (let k = 0; k < 3; k++) {
              ctx.fillStyle = cols[((h * 10 + k) | 0) % 4];
              ctx.beginPath(); ctx.arc(sx + s * (0.25 + 0.25 * k), sy + s * (0.3 + ((h * 7 + k * 0.37) % 0.5)), s * 0.06, 0, TAU); ctx.fill();
            }
          } else if (t === T.HOUSE) this.drawHouse(x, y, sx, sy);
          else if (t === T.TREE || t === T.ROCK || t === T.ENTRANCE) over.push([t, x, y, sx, sy, h]);
        } else {
          if (t === T.WALL || t === T.VOID) {
            if (!this.nearOpen(x, y)) continue;
            ctx.fillStyle = th.wallTop;
            ctx.fillRect(sx, sy, s, s);
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            if (h < 0.5) ctx.fillRect(sx + s * 0.1, sy + s * 0.15, s * 0.4, s * 0.06);
            const below = map.get(x, y + 1);
            if (below !== T.WALL && below !== T.VOID) {
              ctx.fillStyle = th.wall;
              ctx.fillRect(sx, sy + s * 0.45, s, s * 0.55);
              ctx.fillStyle = 'rgba(0,0,0,0.25)';
              ctx.fillRect(sx + (h < 0.5 ? s * 0.5 : 0), sy + s * 0.72, s * 0.04, s * 0.28);
              ctx.fillRect(sx, sy + s * 0.72, s, s * 0.03);
            }
            continue;
          }
          ctx.fillStyle = (x + y) % 2 ? th.floor : th.floor2;
          ctx.fillRect(sx, sy, s, s);
          if (h < 0.08) {
            ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = s * 0.03;
            ctx.beginPath(); ctx.moveTo(sx + s * 0.2, sy + s * 0.3); ctx.lineTo(sx + s * 0.5, sy + s * 0.45); ctx.lineTo(sx + s * 0.6, sy + s * 0.75); ctx.stroke();
          } else if (h > 0.94) {
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.beginPath(); ctx.arc(sx + s * 0.6, sy + s * 0.6, s * 0.08, 0, TAU); ctx.fill();
          }
          if (map.get(x, y - 1) === T.WALL) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(sx, sy, s, s * 0.18); }
          if (t !== T.FLOOR) over.push([t, x, y, sx, sy, h]);
        }
      }
    }
    for (const [t, x, y, sx, sy, h] of over) this.drawObject(t, x, y, sx, sy, h);
  }

  drawHouse(x, y, sx, sy) {
    const { ctx, ts: s, map } = this;
    const below = map.get(x, y + 1) === T.HOUSE;
    if (below) {
      ctx.fillStyle = '#8d3b2f';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#a5483a';
      for (let k = 0; k < 3; k++) ctx.fillRect(sx, sy + (k * s) / 3, s, s * 0.06);
      if (map.get(x, y - 1) !== T.HOUSE) { ctx.fillStyle = '#6d2a20'; ctx.fillRect(sx, sy, s, s * 0.12); }
    } else {
      ctx.fillStyle = '#c8b28a';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#8b6b45';
      ctx.fillRect(sx, sy, s, s * 0.08);
      const left = map.get(x - 1, y) === T.HOUSE, right = map.get(x + 1, y) === T.HOUSE;
      if (left && right && hash2(x, y, 3) < 0.5) {
        ctx.fillStyle = '#5d4037'; ctx.fillRect(sx + s * 0.3, sy + s * 0.35, s * 0.4, s * 0.65);
      } else {
        ctx.fillStyle = '#ffe082'; ctx.fillRect(sx + s * 0.3, sy + s * 0.3, s * 0.4, s * 0.3);
        ctx.strokeStyle = '#5d4037'; ctx.lineWidth = s * 0.04; ctx.strokeRect(sx + s * 0.3, sy + s * 0.3, s * 0.4, s * 0.3);
      }
    }
  }

  drawObject(t, x, y, sx, sy, h) {
    const { ctx, ts: s, map } = this;
    const th = THEMES[map.theme];
    const cx = sx + s / 2, cy = sy + s / 2;
    switch (t) {
      case T.TREE: {
        const r = s * (0.55 + h * 0.15);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.3, r * 0.9, r * 0.45, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(cx - s * 0.07, cy, s * 0.14, s * 0.35);
        ctx.fillStyle = h < 0.5 ? '#2e5d2a' : '#2a5526';
        ctx.beginPath(); ctx.arc(cx, cy - s * 0.1, r, 0, TAU); ctx.fill();
        ctx.fillStyle = h < 0.5 ? '#3b7534' : '#376d31';
        ctx.beginPath(); ctx.arc(cx - r * 0.25, cy - s * 0.1 - r * 0.25, r * 0.6, 0, TAU); ctx.fill();
        break;
      }
      case T.ROCK:
        ctx.fillStyle = '#6d6d6d';
        ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.08, s * 0.45, s * 0.38, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8e8e8e';
        ctx.beginPath(); ctx.ellipse(cx - s * 0.08, cy - s * 0.02, s * 0.3, s * 0.24, 0, 0, TAU); ctx.fill();
        break;
      case T.FOUNTAIN: {
        if (map.get(x - 1, y) === T.FOUNTAIN || map.get(x, y - 1) === T.FOUNTAIN) break;
        const fx = sx + s, fy = sy + s;
        ctx.fillStyle = '#9e9e9e';
        ctx.beginPath(); ctx.arc(fx, fy, s * 0.98, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4fa3e0';
        ctx.beginPath(); ctx.arc(fx, fy, s * 0.78, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = s * 0.05;
        const ph = (this.time * 0.8) % 1;
        ctx.beginPath(); ctx.arc(fx, fy, s * 0.2 + ph * s * 0.55, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#bdbdbd';
        ctx.beginPath(); ctx.arc(fx, fy, s * 0.18, 0, TAU); ctx.fill();
        break;
      }
      case T.ENTRANCE: {
        const ex = map.exits.find((e) => e.x === x && e.y === y);
        const D = DUNGEONS[ex ? ex.dungeon : 0];
        ctx.fillStyle = '#6d6d6d';
        ctx.beginPath(); ctx.ellipse(cx, cy - s * 0.1, s * 0.75, s * 0.7, 0, Math.PI, 0); ctx.fill();
        ctx.fillRect(sx - s * 0.25, cy - s * 0.1, s * 1.5, s * 0.6);
        ctx.fillStyle = '#121014';
        ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.1, s * 0.45, s * 0.55, 0, Math.PI, 0); ctx.fill();
        ctx.fillRect(cx - s * 0.45, cy + s * 0.1, s * 0.9, s * 0.4);
        const pulse = 0.5 + Math.sin(this.time * 3) * 0.2;
        ctx.fillStyle = D.color;
        ctx.globalAlpha = pulse;
        ctx.beginPath(); ctx.arc(cx, cy + s * 0.15, s * 0.18, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case T.PILLAR:
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.3, s * 0.38, s * 0.15, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = th.wall;
        ctx.fillRect(cx - s * 0.32, cy - s * 0.5, s * 0.64, s * 0.8);
        ctx.fillStyle = th.wallTop;
        ctx.beginPath(); ctx.ellipse(cx, cy - s * 0.5, s * 0.32, s * 0.16, 0, 0, TAU); ctx.fill();
        break;
      case T.CRYSTAL: {
        ctx.fillStyle = 'rgba(79,195,247,0.18)';
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.7, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4fc3f7';
        ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.55); ctx.lineTo(cx + s * 0.25, cy); ctx.lineTo(cx, cy + s * 0.35); ctx.lineTo(cx - s * 0.25, cy); ctx.fill();
        ctx.fillStyle = '#b3e5fc';
        ctx.beginPath(); ctx.moveTo(cx + s * 0.22, cy - s * 0.25); ctx.lineTo(cx + s * 0.4, cy + s * 0.05); ctx.lineTo(cx + s * 0.2, cy + s * 0.3); ctx.fill();
        break;
      }
      case T.LAVA: {
        const g = 0.5 + Math.sin(this.time * 2 + x + y) * 0.15;
        ctx.fillStyle = '#bf360c';
        ctx.fillRect(sx, sy, s, s);
        ctx.fillStyle = `rgba(255,${(140 + g * 80) | 0},40,0.9)`;
        ctx.beginPath(); ctx.arc(cx + Math.sin(this.time + h * 9) * s * 0.15, cy, s * 0.3, 0, TAU); ctx.fill();
        break;
      }
      case T.STAIRS:
        ctx.fillStyle = '#16131a';
        ctx.fillRect(sx + s * 0.05, sy + s * 0.05, s * 0.9, s * 0.9);
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = `rgba(255,213,79,${0.55 - k * 0.12})`;
          ctx.fillRect(sx + s * 0.1, sy + s * (0.12 + k * 0.2), s * 0.8, s * 0.1);
        }
        break;
      case T.EXIT:
        ctx.fillStyle = th.wallTop;
        ctx.fillRect(sx, sy, s, s);
        ctx.fillStyle = '#2b2b2b';
        ctx.beginPath(); ctx.ellipse(cx, sy + s * 0.5, s * 0.42, s * 0.4, 0, Math.PI, 0); ctx.fill();
        ctx.fillRect(sx + s * 0.08, sy + s * 0.5, s * 0.84, s * 0.5);
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = `rgba(200,255,200,${0.25 + k * 0.15})`;
          ctx.fillRect(sx + s * 0.15, sy + s * (0.5 + k * 0.16), s * 0.7, s * 0.08);
        }
        break;
    }
  }

  drawExitsGlow(view) {
    const { ctx, ts: s } = this;
    if (view.portal) {
      const x = this.X(view.portal.x + 0.5), y = this.Y(view.portal.y + 0.5);
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = `rgba(128,222,234,${0.8 - k * 0.2})`;
        ctx.lineWidth = s * 0.08;
        ctx.beginPath(); ctx.ellipse(x, y, s * (0.55 - k * 0.12), s * (0.75 - k * 0.15), 0, this.time * (2 + k), this.time * (2 + k) + 4.5); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(178,235,242,0.35)';
      ctx.beginPath(); ctx.ellipse(x, y, s * 0.5, s * 0.7, 0, 0, TAU); ctx.fill();
    }
  }

  drawHazard(h) {
    const { ctx, ts: s } = this;
    const x = this.X(h.x), y = this.Y(h.y);
    const prog = h.dur ? clamp(1 - h.t / h.dur, 0, 1) : 1;
    const col = h.c || '#ff5252';
    ctx.save();
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = s * 0.06;
    if (h.shape === 'circle') {
      ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.arc(x, y, h.r * s, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(x, y, h.r * s * prog, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(x, y, h.r * s, 0, TAU); ctx.stroke();
    } else if (h.shape === 'cone') {
      const wedge = (r) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, h.a - h.arc / 2, h.a + h.arc / 2); ctx.closePath(); };
      ctx.globalAlpha = 0.18; wedge(h.r * s); ctx.fill();
      ctx.globalAlpha = 0.35; wedge(h.r * s * prog); ctx.fill();
      ctx.globalAlpha = 0.9; wedge(h.r * s); ctx.stroke();
    } else {
      ctx.translate(x, y); ctx.rotate(h.a);
      ctx.globalAlpha = 0.22; ctx.fillRect(0, (-h.w * s) / 2, h.len * s, h.w * s);
      ctx.globalAlpha = 0.45; ctx.fillRect(0, (-h.w * s) / 2, h.len * s * prog, h.w * s);
      ctx.globalAlpha = 0.9; ctx.strokeRect(0, (-h.w * s) / 2, h.len * s, h.w * s);
    }
    ctx.restore();
  }

  drawSwings(dt) {
    const { ctx, ts: s } = this;
    this.swings = this.swings.filter((w) => (w.life -= dt) > 0);
    for (const w of this.swings) {
      const k = w.life / w.max;
      ctx.globalAlpha = k * 0.55;
      ctx.fillStyle = w.c;
      ctx.beginPath();
      ctx.moveTo(this.X(w.x), this.Y(w.y));
      ctx.arc(this.X(w.x), this.Y(w.y), w.r * s, w.a - w.arc / 2, w.a + w.arc / 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.arc(this.X(w.x), this.Y(w.y), w.r * s * 0.95, w.a - w.arc / 2, w.a + w.arc / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  animOf(o, dt) {
    let a = this.anim.get(o.id);
    if (!a) { a = { x: o.x, y: o.y, move: 0, hurt: 0, phase: Math.random() * 6 }; this.anim.set(o.id, a); }
    const sp = Math.hypot(o.x - a.x, o.y - a.y) / Math.max(dt, 1e-3);
    a.move = lerp(a.move, sp > 0.5 ? 1 : 0, 0.2);
    a.x = o.x; a.y = o.y;
    a.hurt = Math.max(0, a.hurt - dt);
    a.phase += dt * (6 + a.move * 8);
    return a;
  }

  drawPlayer(p, isMe, dt) {
    const { ctx, ts: s } = this;
    const a = this.animOf(p, dt);
    const c = CLASSES[p.cls];
    const x = this.X(p.x), y = this.Y(p.y);
    const bob = a.move * Math.abs(Math.sin(a.phase)) * s * 0.06;
    const R = s * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.26, s * 0.3, s * 0.11, 0, 0, TAU); ctx.fill();

    if (p.downed) {
      ctx.save();
      ctx.translate(x, y + s * 0.1);
      ctx.fillStyle = shade(c.color, -0.35);
      ctx.beginPath(); ctx.ellipse(0, 0, R * 1.1, R * 0.6, 0, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = s * 0.07;
      ctx.beginPath(); ctx.arc(x, y, s * 0.55, 0, TAU); ctx.stroke();
      if (p.revive > 0) {
        ctx.strokeStyle = '#69f0ae';
        ctx.beginPath(); ctx.arc(x, y, s * 0.55, -Math.PI / 2, -Math.PI / 2 + TAU * p.revive); ctx.stroke();
      }
      ctx.fillStyle = '#ff5252';
      ctx.font = `bold ${Math.round(s * 0.5)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('!', x, y - s * 0.55 - Math.abs(Math.sin(this.time * 4)) * s * 0.15);
      this.drawName(p, x, y, isMe);
      return;
    }

    if (p.invT > 0 && Math.floor(this.time * 20) % 2) ctx.globalAlpha = 0.5;
    const by = y - bob;
    const aim = p.aim || 0;
    const ax = Math.cos(aim), ay = Math.sin(aim);
    const back = ay < -0.3;
    if (back) this.drawWeapon(p, x, by, aim, R);
    ctx.fillStyle = c.color;
    ctx.strokeStyle = shade(c.color, -0.5);
    ctx.lineWidth = s * 0.05;
    ctx.beginPath(); ctx.arc(x, by, R, 0, TAU); ctx.fill(); ctx.stroke();
    // Tête / coiffe selon la classe.
    if (p.cls === 'guerrier') {
      ctx.fillStyle = '#b0bec5';
      ctx.beginPath(); ctx.arc(x, by - R * 0.15, R * 0.78, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#37474f';
      ctx.fillRect(x - R * 0.55 + ax * R * 0.2, by - R * 0.2, R * 1.1, R * 0.16);
    } else if (p.cls === 'rodeur') {
      ctx.fillStyle = '#2e7d32';
      ctx.beginPath(); ctx.moveTo(x - R * 0.85, by - R * 0.05); ctx.lineTo(x, by - R * 1.35); ctx.lineTo(x + R * 0.85, by - R * 0.05); ctx.fill();
    } else if (p.cls === 'mage') {
      ctx.fillStyle = '#5e35b1';
      ctx.beginPath(); ctx.moveTo(x - R * 0.95, by - R * 0.35); ctx.lineTo(x + R * 0.2, by - R * 1.9); ctx.lineTo(x + R * 0.95, by - R * 0.35); ctx.fill();
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath(); ctx.arc(x + R * 0.05, by - R * 0.95, R * 0.14, 0, TAU); ctx.fill();
    } else if (p.cls === 'clerc') {
      ctx.strokeStyle = '#fff59d';
      ctx.lineWidth = s * 0.05;
      ctx.beginPath(); ctx.ellipse(x, by - R * 1.2, R * 0.55, R * 0.18, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fffde7';
      ctx.fillRect(x - R * 0.12, by - R * 0.55, R * 0.24, R * 0.8);
      ctx.fillRect(x - R * 0.38, by - R * 0.32, R * 0.76, R * 0.22);
    }
    if (!back) {
      ctx.fillStyle = '#fff';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + ax * R * 0.45 - ay * side * R * 0.3, by + ay * R * 0.3 + ax * side * R * 0.3 * 0.5 + R * 0.05, R * 0.13, 0, TAU);
        ctx.fill();
      }
      this.drawWeapon(p, x, by, aim, R);
    }
    if (a.hurt > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.arc(x, by, R, 0, TAU); ctx.fill();
    }
    if (p.guardT > 0) {
      ctx.strokeStyle = 'rgba(255,138,101,0.8)'; ctx.lineWidth = s * 0.06;
      ctx.beginPath(); ctx.arc(x, by, R * 1.5, this.time * 3, this.time * 3 + 4.5); ctx.stroke();
    }
    if (p.shield > 0) {
      ctx.fillStyle = 'rgba(128,222,234,0.22)'; ctx.strokeStyle = 'rgba(128,222,234,0.8)'; ctx.lineWidth = s * 0.04;
      ctx.beginPath(); ctx.arc(x, by, R * 1.6, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.drawName(p, x, y, isMe);
  }

  drawWeapon(p, x, y, aim, R) {
    const { ctx, ts: s } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(aim);
    ctx.lineCap = 'round';
    if (p.cls === 'guerrier') {
      ctx.strokeStyle = '#eceff1'; ctx.lineWidth = s * 0.07;
      ctx.beginPath(); ctx.moveTo(R * 0.8, 0); ctx.lineTo(R * 2.3, 0); ctx.stroke();
      ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = s * 0.06;
      ctx.beginPath(); ctx.moveTo(R * 0.8, -R * 0.35); ctx.lineTo(R * 0.8, R * 0.35); ctx.stroke();
      ctx.fillStyle = '#78909c';
      ctx.beginPath(); ctx.ellipse(R * 0.2, -R * 0.95, R * 0.35, R * 0.5, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = s * 0.03; ctx.stroke();
    } else if (p.cls === 'rodeur') {
      ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = s * 0.06;
      ctx.beginPath(); ctx.arc(R * 0.6, 0, R * 0.95, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = '#eeeeee'; ctx.lineWidth = s * 0.02;
      ctx.beginPath(); ctx.moveTo(R * 0.6 + Math.cos(-1.2) * R * 0.95, Math.sin(-1.2) * R * 0.95);
      ctx.lineTo(R * 0.6 + Math.cos(1.2) * R * 0.95, Math.sin(1.2) * R * 0.95); ctx.stroke();
    } else if (p.cls === 'mage') {
      ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = s * 0.06;
      ctx.beginPath(); ctx.moveTo(R * 0.5, R * 0.6); ctx.lineTo(R * 1.9, R * 0.6); ctx.stroke();
      ctx.fillStyle = '#b388ff';
      ctx.shadowColor = '#b388ff'; ctx.shadowBlur = s * 0.3;
      ctx.beginPath(); ctx.arc(R * 2.0, R * 0.6, R * 0.28, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = s * 0.06;
      ctx.beginPath(); ctx.moveTo(R * 0.7, 0); ctx.lineTo(R * 1.9, 0); ctx.stroke();
      ctx.fillStyle = '#ffd54f';
      ctx.fillRect(R * 1.7, -R * 0.35, R * 0.45, R * 0.7);
    }
    ctx.restore();
  }

  drawName(p, x, y, isMe) {
    const { ctx, ts: s } = this;
    const w = s * 0.9, h = Math.max(3, s * 0.08);
    const top = y - s * 0.8;
    if (!isMe) {
      ctx.font = `600 ${Math.round(s * 0.26)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(p.name + (p.bot ? ' (IA)' : ''), x + 1, top - s * 0.08 + 1);
      ctx.fillStyle = p.bot ? '#cfd8dc' : '#ffffff';
      ctx.fillText(p.name + (p.bot ? ' (IA)' : ''), x, top - s * 0.08);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, h + 2);
    ctx.fillStyle = p.hp / p.maxHp > 0.35 ? '#66bb6a' : '#ef5350';
    ctx.fillRect(x - w / 2, top, (w * p.hp) / p.maxHp, h);
    if (p.shield > 0) { ctx.fillStyle = '#80deea'; ctx.fillRect(x - w / 2, top, Math.min(w, (w * p.shield) / p.maxHp), h * 0.45); }
  }

  drawEnemy(e, dt) {
    const { ctx, ts: s } = this;
    const a = this.animOf(e, dt);
    const def = ENEMIES[e.type];
    const x = this.X(e.x), y = this.Y(e.y);
    const R = e.r * s;
    const t = this.time + a.phase;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y + R * 0.8, R * 0.95, R * 0.35, 0, 0, TAU); ctx.fill();
    if (e.wind) {
      ctx.fillStyle = `rgba(255,82,82,${0.25 + Math.sin(this.time * 30) * 0.15})`;
      ctx.beginPath(); ctx.arc(x, y, R * 1.45, 0, TAU); ctx.fill();
    }
    const ax = Math.cos(e.aim || 0), ay = Math.sin(e.aim || 0);
    const eyes = (col, dx = 0.35, size = 0.14, off = 0) => {
      ctx.fillStyle = col;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + ax * R * dx - ay * side * R * 0.3, y + ay * R * dx * 0.6 + ax * side * R * 0.15 - R * off, R * size, 0, TAU);
        ctx.fill();
      }
    };
    switch (e.type) {
      case 'slime': {
        const sq = 1 + Math.sin(t * 1.3) * 0.1;
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.ellipse(x, y + R * 0.2, R * sq, R * 0.8 / sq, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.ellipse(x - R * 0.35, y - R * 0.15, R * 0.25, R * 0.15, -0.5, 0, TAU); ctx.fill();
        eyes('#1b1b1b', 0.3, 0.13);
        break;
      }
      case 'loup': {
        ctx.save(); ctx.translate(x, y); ctx.rotate(e.aim || 0);
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.ellipse(-R * 0.2, 0, R * 1.1, R * 0.65, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(R * 0.75, 0, R * 0.5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#757575';
        ctx.beginPath(); ctx.moveTo(R * 0.6, -R * 0.35); ctx.lineTo(R * 0.85, -R * 0.75); ctx.lineTo(R * 0.95, -R * 0.3); ctx.fill();
        ctx.beginPath(); ctx.moveTo(R * 0.6, R * 0.35); ctx.lineTo(R * 0.85, R * 0.75); ctx.lineTo(R * 0.95, R * 0.3); ctx.fill();
        ctx.fillStyle = '#ffeb3b';
        ctx.beginPath(); ctx.arc(R * 0.95, -R * 0.18, R * 0.1, 0, TAU); ctx.arc(R * 0.95, R * 0.18, R * 0.1, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
      case 'gobelin':
      case 'diablotin': {
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
        if (e.type === 'gobelin') {
          ctx.beginPath(); ctx.moveTo(x - R * 0.7, y - R * 0.3); ctx.lineTo(x - R * 1.6, y - R * 0.8); ctx.lineTo(x - R * 0.6, y + R * 0.1); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + R * 0.7, y - R * 0.3); ctx.lineTo(x + R * 1.6, y - R * 0.8); ctx.lineTo(x + R * 0.6, y + R * 0.1); ctx.fill();
          eyes('#ffeb3b');
          ctx.strokeStyle = '#cfd8dc'; ctx.lineWidth = s * 0.05;
          ctx.beginPath(); ctx.moveTo(x + ax * R, y + ay * R); ctx.lineTo(x + ax * R * 1.8, y + ay * R * 1.8); ctx.stroke();
        } else {
          ctx.fillStyle = '#3e2723';
          ctx.beginPath(); ctx.moveTo(x - R * 0.6, y - R * 0.6); ctx.lineTo(x - R * 0.4, y - R * 1.4); ctx.lineTo(x - R * 0.15, y - R * 0.8); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + R * 0.6, y - R * 0.6); ctx.lineTo(x + R * 0.4, y - R * 1.4); ctx.lineTo(x + R * 0.15, y - R * 0.8); ctx.fill();
          eyes('#ffeb3b');
          ctx.fillStyle = 'rgba(255,171,64,0.8)';
          ctx.beginPath(); ctx.arc(x + ax * R * 1.2, y + ay * R * 1.2, R * 0.3 + Math.sin(this.time * 12) * R * 0.05, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'squelette': {
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.arc(x, y - R * 0.1, R * 0.85, 0, TAU); ctx.fill();
        ctx.fillRect(x - R * 0.45, y + R * 0.4, R * 0.9, R * 0.4);
        eyes('#212121', 0.25, 0.2, 0.15);
        ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = s * 0.05;
        ctx.beginPath(); ctx.arc(x + ax * R * 0.5, y + ay * R * 0.5, R * 0.9, (e.aim || 0) - 1.1, (e.aim || 0) + 1.1); ctx.stroke();
        break;
      }
      case 'chauvesouris': {
        const flap = Math.sin(this.time * 18 + a.phase) * 0.6;
        ctx.fillStyle = def.color;
        for (const side of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(x, y);
          ctx.lineTo(x + side * R * 2.2, y - R * (0.8 + flap)); ctx.lineTo(x + side * R * 1.4, y + R * 0.3); ctx.lineTo(x + side * R * 0.8, y - R * 0.1);
          ctx.fill();
        }
        ctx.fillStyle = '#4a2c7a';
        ctx.beginPath(); ctx.arc(x, y, R * 0.75, 0, TAU); ctx.fill();
        eyes('#ff5252', 0.25, 0.16);
        break;
      }
      case 'ombre': {
        const fl = Math.sin(t * 0.8) * R * 0.15;
        ctx.fillStyle = 'rgba(92,61,143,0.85)';
        ctx.beginPath(); ctx.moveTo(x, y - R * 1.2 + fl); ctx.quadraticCurveTo(x + R * 1.3, y + fl, x + R * 0.8, y + R + fl);
        ctx.lineTo(x - R * 0.8, y + R + fl); ctx.quadraticCurveTo(x - R * 1.3, y + fl, x, y - R * 1.2 + fl); ctx.fill();
        ctx.shadowColor = '#e040fb'; ctx.shadowBlur = s * 0.2;
        eyes('#e040fb', 0.2, 0.14, 0.3);
        ctx.shadowBlur = 0;
        break;
      }
      case 'brute': {
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
        ctx.fillStyle = '#efebe9';
        ctx.beginPath(); ctx.moveTo(x - R * 0.6, y - R * 0.6); ctx.lineTo(x - R * 0.9, y - R * 1.3); ctx.lineTo(x - R * 0.3, y - R * 0.8); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + R * 0.6, y - R * 0.6); ctx.lineTo(x + R * 0.9, y - R * 1.3); ctx.lineTo(x + R * 0.3, y - R * 0.8); ctx.fill();
        eyes('#ff1744', 0.35, 0.12);
        ctx.strokeStyle = '#5d4037'; ctx.lineWidth = s * 0.12;
        ctx.beginPath(); ctx.moveTo(x + ax * R * 0.8 - ay * R * 0.6, y + ay * R * 0.8 + ax * R * 0.6); ctx.lineTo(x + ax * R * 1.8 - ay * R * 0.6, y + ay * R * 1.8 + ax * R * 0.6); ctx.stroke();
        break;
      }
      case 'cristal': {
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 0.5) * 0.3);
        ctx.shadowColor = '#4fc3f7'; ctx.shadowBlur = s * 0.3;
        ctx.fillStyle = '#4fc3f7';
        ctx.beginPath(); ctx.moveTo(0, -R * 1.3); ctx.lineTo(R * 0.8, 0); ctx.lineTo(0, R * 1.1); ctx.lineTo(-R * 0.8, 0); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#e1f5fe';
        ctx.beginPath(); ctx.moveTo(0, -R * 0.8); ctx.lineTo(R * 0.35, 0); ctx.lineTo(0, R * 0.5); ctx.lineTo(-R * 0.35, 0); ctx.fill();
        ctx.restore();
        break;
      }
      case 'roi_squelette': {
        ctx.fillStyle = '#4a148c';
        ctx.beginPath(); ctx.moveTo(x - R * 1.1, y + R); ctx.lineTo(x, y - R * 0.2); ctx.lineTo(x + R * 1.1, y + R); ctx.fill();
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.arc(x, y - R * 0.2, R * 0.8, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath(); ctx.moveTo(x - R * 0.65, y - R * 0.75);
        for (let k = 0; k <= 4; k++) { ctx.lineTo(x - R * 0.65 + k * R * 0.325, y - R * (k % 2 ? 1.0 : 1.45)); }
        ctx.lineTo(x + R * 0.65, y - R * 0.75); ctx.fill();
        ctx.shadowColor = '#e040fb'; ctx.shadowBlur = s * 0.3;
        eyes('#e040fb', 0.2, 0.17, 0.25);
        ctx.shadowBlur = 0;
        break;
      }
      case 'golem': {
        ctx.fillStyle = '#607d8b';
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const an = (k / 8) * TAU, rr = R * (0.9 + hash2(k, e.id, 1) * 0.2);
          ctx.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr);
        }
        ctx.fill();
        ctx.fillStyle = '#4fc3f7';
        ctx.shadowColor = '#4fc3f7'; ctx.shadowBlur = s * 0.3;
        for (const [ox, oy] of [[-0.5, -0.6], [0.55, -0.5], [0.1, 0.6]]) {
          ctx.beginPath(); ctx.moveTo(x + ox * R, y + oy * R - R * 0.35); ctx.lineTo(x + ox * R + R * 0.15, y + oy * R); ctx.lineTo(x + ox * R, y + oy * R + R * 0.2); ctx.lineTo(x + ox * R - R * 0.15, y + oy * R); ctx.fill();
        }
        eyes('#e1f5fe', 0.3, 0.12, 0.1);
        ctx.shadowBlur = 0;
        break;
      }
      case 'dragon': {
        const flap = Math.sin(this.time * 4) * 0.25;
        ctx.save(); ctx.translate(x, y); ctx.rotate(e.aim || 0);
        ctx.fillStyle = '#b71c1c';
        for (const side of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(-R * 0.2, 0);
          ctx.lineTo(-R * 0.6, side * R * (1.9 + flap)); ctx.lineTo(R * 0.3, side * R * (1.4 + flap)); ctx.lineTo(R * 0.4, side * R * 0.4); ctx.fill();
        }
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.ellipse(-R * 0.1, 0, R * 1.0, R * 0.7, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-R * 0.9, -R * 0.2); ctx.lineTo(-R * 1.9, 0); ctx.lineTo(-R * 0.9, R * 0.2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(R * 1.05, 0, R * 0.5, R * 0.38, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffeb3b';
        ctx.beginPath(); ctx.arc(R * 1.2, -R * 0.18, R * 0.08, 0, TAU); ctx.arc(R * 1.2, R * 0.18, R * 0.08, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
      default:
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    }
    if (e.flash > 0 || a.hurt > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    }
    if (e.slowT > 0) {
      ctx.strokeStyle = 'rgba(129,212,250,0.9)'; ctx.lineWidth = s * 0.05;
      ctx.beginPath(); ctx.arc(x, y, R * 1.15, 0, TAU); ctx.stroke();
    }
    if (!e.boss && e.hp < e.maxHp) {
      const w = Math.max(s * 0.7, R * 2), h = Math.max(3, s * 0.07);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - w / 2 - 1, y - R - s * 0.3 - 1, w + 2, h + 2);
      ctx.fillStyle = '#ef5350';
      ctx.fillRect(x - w / 2, y - R - s * 0.3, (w * e.hp) / e.maxHp, h);
    }
  }

  drawProj(p) {
    const { ctx, ts: s } = this;
    const x = this.X(p.x), y = this.Y(p.y);
    const a = Math.atan2(p.vy, p.vx);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    switch (p.type) {
      case 'arrow':
        ctx.strokeStyle = '#d7ccc8'; ctx.lineWidth = s * 0.05;
        ctx.beginPath(); ctx.moveTo(-s * 0.35, 0); ctx.lineTo(s * 0.2, 0); ctx.stroke();
        ctx.fillStyle = '#eceff1';
        ctx.beginPath(); ctx.moveTo(s * 0.3, 0); ctx.lineTo(s * 0.15, -s * 0.08); ctx.lineTo(s * 0.15, s * 0.08); ctx.fill();
        break;
      case 'bolt':
        glow(ctx, '#b388ff', s * 0.14, s);
        ctx.fillStyle = 'rgba(179,136,255,0.35)';
        ctx.beginPath(); ctx.ellipse(-s * 0.2, 0, s * 0.25, s * 0.08, 0, 0, TAU); ctx.fill();
        break;
      case 'fireball':
        glow(ctx, '#ff9100', s * 0.25, s);
        ctx.fillStyle = '#fff3e0';
        ctx.beginPath(); ctx.arc(0, 0, s * 0.1, 0, TAU); ctx.fill();
        if (Math.random() < 0.6) this.particles.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), life: 0.3, max: 0.3, c: '#ff6d00', size: 0.08 });
        break;
      case 'bone':
        ctx.rotate(this.time * 15);
        ctx.fillStyle = '#efebe9';
        ctx.fillRect(-s * 0.18, -s * 0.04, s * 0.36, s * 0.08);
        ctx.beginPath(); ctx.arc(-s * 0.18, 0, s * 0.07, 0, TAU); ctx.arc(s * 0.18, 0, s * 0.07, 0, TAU); ctx.fill();
        break;
      case 'orb': glow(ctx, '#d500f9', s * 0.17, s); break;
      case 'shard':
        ctx.fillStyle = '#80d8ff'; ctx.shadowColor = '#4fc3f7'; ctx.shadowBlur = s * 0.2;
        ctx.beginPath(); ctx.moveTo(s * 0.22, 0); ctx.lineTo(0, -s * 0.09); ctx.lineTo(-s * 0.18, 0); ctx.lineTo(0, s * 0.09); ctx.fill();
        break;
      case 'fire': glow(ctx, '#ff5722', s * 0.16, s); break;
    }
    ctx.restore();
  }

  drawItem(it) {
    const { ctx, ts: s } = this;
    const x = this.X(it.x), y = this.Y(it.y);
    const b = Math.sin(this.time * 3 + it.id) * s * 0.05;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.22, s * 0.22, s * 0.08, 0, 0, TAU); ctx.fill();
    if (it.type === 'chest' || it.type === 'bigchest') {
      const k = it.type === 'bigchest' ? 1.35 : 1;
      const w = s * 0.7 * k, h = s * 0.5 * k;
      ctx.fillStyle = '#8d5a2b';
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = '#a86d35';
      ctx.fillRect(x - w / 2, y - h / 2, w, h * 0.4);
      ctx.fillStyle = it.type === 'bigchest' ? '#ffd54f' : '#e0b54a';
      ctx.fillRect(x - w / 2, y - h * 0.12, w, h * 0.12);
      ctx.fillRect(x - w * 0.08, y - h * 0.2, w * 0.16, h * 0.3);
      if (it.type === 'bigchest') {
        ctx.globalAlpha = 0.4 + Math.sin(this.time * 4) * 0.2;
        ctx.strokeStyle = '#fff59d'; ctx.lineWidth = s * 0.05;
        ctx.strokeRect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6);
        ctx.globalAlpha = 1;
      }
      return;
    }
    const yy = y - s * 0.1 + b;
    if (it.type === 'potion') {
      ctx.fillStyle = '#e53935';
      ctx.beginPath(); ctx.arc(x, yy + s * 0.05, s * 0.17, 0, TAU); ctx.fill();
      ctx.fillStyle = '#bcaaa4';
      ctx.fillRect(x - s * 0.05, yy - s * 0.22, s * 0.1, s * 0.14);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(x - s * 0.06, yy, s * 0.05, 0, TAU); ctx.fill();
    } else if (it.type === 'gem') {
      ctx.fillStyle = '#ab47bc'; ctx.shadowColor = '#e040fb'; ctx.shadowBlur = s * 0.3;
      ctx.beginPath(); ctx.moveTo(x, yy - s * 0.22); ctx.lineTo(x + s * 0.18, yy); ctx.lineTo(x, yy + s * 0.22); ctx.lineTo(x - s * 0.18, yy); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (it.type === 'heart') {
      ctx.fillStyle = '#ec407a'; ctx.shadowColor = '#ff80ab'; ctx.shadowBlur = s * 0.25;
      ctx.beginPath();
      ctx.moveTo(x, yy + s * 0.18);
      ctx.bezierCurveTo(x - s * 0.3, yy - s * 0.02, x - s * 0.12, yy - s * 0.28, x, yy - s * 0.08);
      ctx.bezierCurveTo(x + s * 0.12, yy - s * 0.28, x + s * 0.3, yy - s * 0.02, x, yy + s * 0.18);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  drawParticles(dt) {
    const { ctx, ts: s } = this;
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      ctx.globalAlpha = Math.min(1, p.life / p.max * 1.5);
      ctx.fillStyle = p.c;
      const x = this.X(p.x), y = this.Y(p.y), r = p.size * s;
      if (p.plus) { ctx.fillRect(x - r, y - r * 0.3, r * 2, r * 0.6); ctx.fillRect(x - r * 0.3, y - r, r * 0.6, r * 2); }
      else ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    this.rings = this.rings.filter((r) => (r.life -= dt) > 0);
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      const rad = lerp(r.r0, r.r1, Math.sqrt(k)) * s;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = r.c;
      ctx.lineWidth = r.w * s * (1 - k * 0.5);
      ctx.beginPath(); ctx.arc(this.X(r.x), this.Y(r.y), rad, 0, TAU); ctx.stroke();
      if (r.fill) { ctx.globalAlpha = (1 - k) * 0.2; ctx.fillStyle = r.c; ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  drawTexts(dt) {
    const { ctx, ts: s } = this;
    this.texts = this.texts.filter((t) => (t.life -= dt) > 0);
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      t.y -= dt * 0.9;
      const big = /^\d+$/.test(t.v) && +t.v >= 40;
      ctx.font = `800 ${Math.round(s * (big ? 0.42 : 0.32))}px ${FONT}`;
      ctx.globalAlpha = Math.min(1, t.life * 2.5);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(t.v, this.X(t.x) + 1.5, this.Y(t.y) + 1.5);
      ctx.fillStyle = t.c;
      ctx.fillText(t.v, this.X(t.x), this.Y(t.y));
    }
    ctx.globalAlpha = 1;
  }

  drawDarkness(view) {
    const { lctx, light, ts: s, W, H } = this;
    const k = light.width / W;
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, light.width, light.height);
    lctx.fillStyle = 'rgba(4,3,8,0.93)';
    lctx.fillRect(0, 0, light.width, light.height);
    lctx.globalCompositeOperation = 'destination-out';
    const hole = (wx, wy, r, strength = 1) => {
      const x = this.X(wx) * k, y = this.Y(wy) * k, rr = r * s * k;
      if (x < -rr || y < -rr || x > light.width + rr || y > light.height + rr) return;
      const g = lctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.85})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = g;
      lctx.beginPath(); lctx.arc(x, y, rr, 0, TAU); lctx.fill();
    };
    for (const p of view.players) hole(p.x, p.y, p.downed ? 3.5 : 7, 1);
    for (const p of view.projs) if (p.type === 'fireball' || p.type === 'fire' || p.type === 'orb' || p.type === 'bolt') hole(p.x, p.y, p.type === 'fireball' ? 3 : 1.6, 0.8);
    for (const e of view.enemies) if (e.boss && e.state !== 'idle') hole(e.x, e.y, 4, 0.7);
    for (const r of this.rings) if (r.light) hole(r.x, r.y, r.r1 + 1.5, 0.9 * (r.life / r.max));
    for (const ex of this.map.exits) hole(ex.x + 0.5, ex.y + 0.5, 2.2, 0.7);
    if (view.portal) hole(view.portal.x + 0.5, view.portal.y + 0.5, 3, 0.8);
    const x0 = Math.floor(-this.ox / s), y0 = Math.floor(-this.oy / s);
    for (let y = y0; y < y0 + H / s + 2; y++) {
      for (let x = x0; x < x0 + W / s + 2; x++) {
        const t = this.map.get(x, y);
        if (t === T.CRYSTAL || t === T.LAVA) hole(x + 0.5, y + 0.5, t === T.LAVA ? 2.2 : 1.6, 0.6);
      }
    }
    this.ctx.drawImage(light, 0, 0, W, H);
  }

  drawFog(x0, y0, x1, y1) {
    const { ctx, ts: s, map } = this;
    ctx.fillStyle = map.kind === 'world' ? '#0c140b' : '#050407';
    ctx.beginPath();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x >= 0 && y >= 0 && x < map.w && y < map.h && this.explored[y * map.w + x]) continue;
        ctx.rect(x * s + this.ox - 0.5, y * s + this.oy - 0.5, s + 1, s + 1);
      }
    }
    ctx.fill();
    // Bord adouci : les tuiles explorées voisines de l'inconnu sont assombries.
    const seen = (x, y) => x >= 0 && y >= 0 && x < map.w && y < map.h && this.explored[y * map.w + x];
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!seen(x, y) || (seen(x - 1, y) && seen(x + 1, y) && seen(x, y - 1) && seen(x, y + 1))) continue;
        ctx.rect(x * s + this.ox - 0.5, y * s + this.oy - 0.5, s + 1, s + 1);
      }
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ───────────── Interface ─────────────

  drawHud(view, me, dt, ui) {
    const { ctx, W, H, u } = this;
    if (this.hurtFlash > 0) {
      this.hurtFlash -= dt;
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(255,0,0,0)');
      g.addColorStop(1, `rgba(200,0,0,${this.hurtFlash})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    this.drawParty(view, me);
    this.drawMinimap(view, me, ui);
    this.drawBossBar(view);
    if (me) this.drawSkillBar(me, ui);
    this.drawGather(view, ui);
    this.drawToasts(dt);
    if (view.wipeT > 0) {
      ctx.fillStyle = `rgba(40,0,0,${Math.min(0.6, view.wipeT * 0.3)})`;
      ctx.fillRect(0, 0, W, H);
      this.centerText('Le groupe est tombé…', H * 0.42, 34 * u, '#ff8a80');
      this.centerText('Retour au point de départ', H * 0.42 + 40 * u, 18 * u, '#ffccbc');
    } else if (me && me.downed) {
      this.centerText('Vous êtes à terre', H * 0.3, 28 * u, '#ff8a80');
      this.centerText(view.players.length > 1 ? 'Un allié doit rester près de vous pour vous relever' : '', H * 0.3 + 32 * u, 16 * u, '#ffccbc');
    }
    if (this.victoryT > 0) {
      this.victoryT -= dt;
      ctx.globalAlpha = Math.min(1, this.victoryT);
      this.centerText('VICTOIRE !', H * 0.35, 64 * u, '#ffd54f');
      this.centerText('Le Dragon Ancien est vaincu. La vallée est sauvée !', H * 0.35 + 50 * u, 20 * u, '#fff8e1');
      ctx.globalAlpha = 1;
    }
    if (ui.showMap) this.drawBigMap(view, me);
    if (ui.device === 'touch') this.drawTouch(ui, me);
    else this.touchButtons = [];
  }

  centerText(text, y, size, color) {
    const { ctx, W } = this;
    ctx.font = `800 ${Math.round(size)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillText(text, W / 2 + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, y);
  }

  panel(x, y, w, h, r = 8) {
    const { ctx, u } = this;
    ctx.fillStyle = 'rgba(12,10,20,0.72)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1 * u;
    roundRect(ctx, x, y, w, h, r * u);
    ctx.fill(); ctx.stroke();
  }

  drawParty(view, me) {
    const { ctx, u } = this;
    let y = 10 * u;
    const w = 210 * u, h = 44 * u, x = 10 * u;
    const list = [...view.players].sort((a, b) => (a === me ? -1 : b === me ? 1 : 0));
    for (const p of list) {
      const c = CLASSES[p.cls];
      this.panel(x, y, w, h);
      ctx.fillStyle = c.color;
      roundRect(ctx, x + 6 * u, y + 6 * u, 32 * u, 32 * u, 6 * u); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(16 * u)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(p.level), x + 22 * u, y + 28 * u);
      ctx.textAlign = 'left';
      ctx.font = `700 ${Math.round(13 * u)}px ${FONT}`;
      ctx.fillStyle = p === me ? '#ffe082' : '#fff';
      ctx.fillText(`${p.name}${p.bot ? ' (IA)' : ''}`.slice(0, 22), x + 46 * u, y + 17 * u);
      ctx.font = `${Math.round(11 * u)}px ${FONT}`;
      ctx.fillStyle = '#b0bec5';
      ctx.textAlign = 'right';
      ctx.fillText(c.name, x + w - 8 * u, y + 17 * u);
      const bx = x + 46 * u, by = y + 24 * u, bw = w - 54 * u, bh = 12 * u;
      ctx.fillStyle = '#263238';
      ctx.fillRect(bx, by, bw, bh);
      if (p.downed) {
        ctx.fillStyle = '#b71c1c';
        ctx.fillRect(bx, by, bw * (p.revive || 0), bh);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = `800 ${Math.round(10 * u)}px ${FONT}`;
        ctx.fillText('À TERRE', bx + bw / 2, by + bh - 2 * u);
      } else {
        ctx.fillStyle = p.hp / p.maxHp > 0.35 ? '#43a047' : '#e53935';
        ctx.fillRect(bx, by, (bw * p.hp) / p.maxHp, bh);
        if (p.shield > 0) { ctx.fillStyle = 'rgba(128,222,234,0.85)'; ctx.fillRect(bx, by, Math.min(bw, (bw * p.shield) / p.maxHp), bh * 0.35); }
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = `700 ${Math.round(10 * u)}px ${FONT}`;
        ctx.fillText(`${Math.ceil(p.hp)} / ${p.maxHp}`, bx + bw / 2, by + bh - 2 * u);
      }
      y += h + 6 * u;
    }
  }

  drawSkillBar(me, ui) {
    const { ctx, W, H, u } = this;
    const c = CLASSES[me.cls];
    if (ui.device === 'touch') return this.drawXp(me, W / 2 - 150 * u, H - 14 * u, 300 * u);
    const slots = [
      { name: c.atk.name, key: 'Clic G', cd: me.cd[0], max: c.atk.cd },
      { name: c.s1.name, key: 'Clic D / Espace', cd: me.cd[1], max: c.s1.cd },
      { name: c.s2.name, key: 'Maj / E', cd: me.cd[2], max: c.s2.cd },
      { name: `Potion ×${me.potions}`, key: 'R', cd: me.potions ? 0 : 1, max: 1, empty: !me.potions },
    ];
    const sw = 112 * u, sh = 50 * u, gap = 8 * u;
    const total = slots.length * sw + (slots.length - 1) * gap;
    let x = (W - total) / 2;
    const y = H - sh - 22 * u;
    this.drawXp(me, x, H - 14 * u, total);
    for (const sl of slots) {
      this.panel(x, y, sw, sh, 8);
      const ready = sl.cd <= 0 && !sl.empty;
      ctx.textAlign = 'center';
      ctx.fillStyle = ready ? '#fff' : '#90a4ae';
      ctx.font = `700 ${Math.round(12.5 * u)}px ${FONT}`;
      ctx.fillText(sl.name, x + sw / 2, y + 21 * u, sw - 10 * u);
      ctx.fillStyle = ready ? c.color : '#78909c';
      ctx.font = `600 ${Math.round(10.5 * u)}px ${FONT}`;
      ctx.fillText(sl.key, x + sw / 2, y + 38 * u, sw - 10 * u);
      if (sl.cd > 0 && !sl.empty) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        const k = clamp(sl.cd / sl.max, 0, 1);
        ctx.fillRect(x, y + sh * (1 - k), sw, sh * k);
        if (sl.max > 1) {
          ctx.fillStyle = '#fff';
          ctx.font = `800 ${Math.round(16 * u)}px ${FONT}`;
          ctx.fillText(sl.cd.toFixed(sl.cd < 1 ? 1 : 0), x + sw / 2, y + 31 * u);
        }
      }
      x += sw + gap;
    }
  }

  drawXp(me, x, y, w) {
    const { ctx, u } = this;
    const need = xpForLevel(me.level);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, w, 6 * u);
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(x, y, (w * clamp(me.xp / need, 0, 1)), 6 * u);
  }

  drawMinimap(view, me, ui) {
    const { ctx, W, u, map } = this;
    const portrait = this.H > this.W;
    const maxW = (portrait ? 120 : 190) * u, maxH = (portrait ? 100 : 150) * u;
    const k = Math.min(maxW / map.w, maxH / map.h);
    const w = map.w * k, h = map.h * k;
    const x = W - w - 12 * u, y = 12 * u;
    this.panel(x - 6 * u, y - 6 * u, w + 12 * u, h + 46 * u);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mini, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
    this.drawMarkers(view, me, x, y, k, 1);
    ctx.textAlign = 'left';
    ctx.font = `700 ${Math.round(12 * u)}px ${FONT}`;
    ctx.fillStyle = '#ffe082';
    ctx.fillText(mapName(view.mapId), x, y + h + 17 * u, w);
    ctx.font = `${Math.round(11 * u)}px ${FONT}`;
    ctx.fillStyle = '#cfd8dc';
    ctx.fillText(this.objective(view), x, y + h + 33 * u, w);
    if (ui.code) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#80deea';
      ctx.font = `700 ${Math.round(12 * u)}px ${FONT}`;
      ctx.fillText(`Code : ${ui.code}`, x + w, y + h + 17 * u);
    }
  }

  objective(view) {
    const cl = view.cleared || [];
    if (view.victory || cl.every(Boolean)) return 'Toutes les menaces sont vaincues !';
    const next = cl.findIndex((v) => !v);
    if (view.mapId === 'world') return `Objectif : ${DUNGEONS[next].name}`;
    return this.map.bossRoom ? 'Vainquez le gardien du donjon' : 'Trouvez l’escalier qui descend';
  }

  drawMarkers(view, me, x, y, k, scale) {
    const { ctx, u, map } = this;
    const dot = (wx, wy, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + wx * k, y + wy * k, r * u * scale, 0, TAU); ctx.fill(); };
    for (const ex of map.exits) {
      if (!this.explored[ex.y * map.w + ex.x]) continue;
      const locked = ex.kind === 'entrance' && ex.dungeon > 0 && !(view.cleared || [])[ex.dungeon - 1];
      const done = ex.kind === 'entrance' && (view.cleared || [])[ex.dungeon];
      dot(ex.x + 0.5, ex.y + 0.5, 4, '#000');
      dot(ex.x + 0.5, ex.y + 0.5, 3, locked ? '#757575' : done ? '#66bb6a' : ex.kind === 'entrance' ? DUNGEONS[ex.dungeon].color : '#ffd54f');
    }
    if (map.fountain) dot(map.fountain.x, map.fountain.y, 3, '#81d4fa');
    if (view.portal) dot(view.portal.x + 0.5, view.portal.y + 0.5, 3.5, '#80deea');
    for (const e of view.enemies) if (e.boss && this.explored[Math.floor(e.y) * map.w + Math.floor(e.x)]) dot(e.x, e.y, 4, '#ff1744');
    for (const p of view.players) {
      dot(p.x, p.y, 3.6, '#000');
      dot(p.x, p.y, 2.8, p === me ? '#ffffff' : CLASSES[p.cls].color);
    }
  }

  drawBigMap(view, me) {
    const { ctx, W, H, u, map } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, W, H);
    const k = Math.min((W * 0.86) / map.w, (H * 0.78) / map.h);
    const w = map.w * k, h = map.h * k;
    const x = (W - w) / 2, y = (H - h) / 2 + 10 * u;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mini, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
    this.drawMarkers(view, me, x, y, k, 2);
    ctx.font = `600 ${Math.round(12 * u)}px ${FONT}`;
    ctx.textAlign = 'center';
    for (const ex of map.exits) {
      if (ex.kind !== 'entrance' || !this.explored[ex.y * map.w + ex.x]) continue;
      ctx.fillStyle = '#fff';
      ctx.fillText(DUNGEONS[ex.dungeon].name, x + (ex.x + 0.5) * k, y + ex.y * k - 10 * u);
    }
    for (const p of view.players) {
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name, x + p.x * k, y + p.y * k - 9 * u);
    }
    this.centerText(mapName(view.mapId), y - 16 * u, 22 * u, '#ffe082');
  }

  drawBossBar(view) {
    const boss = view.enemies.find((e) => e.boss && e.state !== 'idle');
    if (!boss) return;
    const { ctx, W, u } = this;
    const w = Math.min(520 * u, W * 0.5), h = 16 * u, x = (W - w) / 2, y = 16 * u;
    this.panel(x - 8 * u, y - 6 * u, w + 16 * u, h + 34 * u);
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(x, y + 20 * u, w, h);
    ctx.fillStyle = '#e53935';
    ctx.fillRect(x, y + 20 * u, (w * boss.hp) / boss.maxHp, h);
    ctx.font = `800 ${Math.round(13 * u)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffcdd2';
    ctx.fillText(ENEMIES[boss.type].name, W / 2, y + 12 * u);
  }

  drawGather(view, ui) {
    const g = view.gather;
    if (!g) return;
    const { ctx, W, H, u } = this;
    const y = H - (ui.device === 'touch' ? 60 : 110) * u;
    const text = g.locked ? g.label : g.total > 1 ? `${g.label} — groupe ${g.n}/${g.total}, rassemblez-vous ici` : g.label + '…';
    ctx.font = `700 ${Math.round(15 * u)}px ${FONT}`;
    const tw = ctx.measureText(text).width;
    this.panel(W / 2 - tw / 2 - 14 * u, y - 22 * u, tw + 28 * u, 32 * u);
    ctx.textAlign = 'center';
    ctx.fillStyle = g.locked ? '#ff8a80' : '#fff59d';
    ctx.fillText(text, W / 2, y);
    if (g.p > 0) {
      ctx.fillStyle = '#fff59d';
      ctx.fillRect(W / 2 - tw / 2, y + 6 * u, tw * g.p, 3 * u);
    }
  }

  drawToasts(dt) {
    const { ctx, W, u } = this;
    this.toasts = this.toasts.filter((t) => (t.life -= dt) > 0);
    let y = 90 * u;
    for (const t of this.toasts) {
      ctx.globalAlpha = Math.min(1, t.life);
      ctx.font = `700 ${Math.round(16 * u)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(t.text, W / 2 + 1.5, y + 1.5);
      ctx.fillStyle = t.c;
      ctx.fillText(t.text, W / 2, y);
      y += 24 * u;
    }
    ctx.globalAlpha = 1;
  }

  drawTouch(ui, me) {
    const { ctx, dpr } = this;
    const cw = innerWidth, ch = innerHeight;
    const r = Math.min(cw, ch) * 0.085;
    const c = me ? CLASSES[me.cls] : null;
    const base = { x: cw - r * 1.4, y: ch - r * 1.9 };
    const btns = [
      { id: 's1', x: base.x - r * 2.3, y: base.y + r * 0.1, r, label: c ? c.s1.name : '', cd: me ? me.cd[1] / c.s1.cd : 0 },
      { id: 's2', x: base.x - r * 1.5, y: base.y - r * 1.9, r, label: c ? c.s2.name : '', cd: me ? me.cd[2] / c.s2.cd : 0 },
      { id: 'pot', x: base.x + r * 0.2, y: base.y - r * 2.6, r: r * 0.75, label: me ? `Potion ${me.potions}` : '', cd: 0 },
      { id: 'map', x: cw - r * 0.9, y: ch * 0.5, r: r * 0.6, label: 'Carte', cd: 0 },
      { id: 'pause', x: cw * 0.5, y: r * 0.7, r: r * 0.5, label: 'II', cd: 0 },
    ];
    this.touchButtons = btns;
    for (const b of btns) {
      const x = b.x * dpr, y = b.y * dpr, rr = b.r * dpr;
      ctx.fillStyle = 'rgba(20,20,30,0.45)';
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill(); ctx.stroke();
      if (b.cd > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + TAU * b.cd); ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(rr * 0.3)}px ${FONT}`;
      ctx.textAlign = 'center';
      wrapText(ctx, b.label, x, y, rr * 1.7, rr * 0.34);
    }
    for (const st of [ui.touch.move, ui.touch.aim]) {
      if (!st) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); ctx.arc(st.ox * dpr, st.oy * dpr, 50 * dpr, 0, TAU); ctx.stroke();
      const dx = st.x - st.ox, dy = st.y - st.oy, l = Math.hypot(dx, dy), m = Math.min(l, 50);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc((st.ox + (l ? (dx / l) * m : 0)) * dpr, (st.oy + (l ? (dy / l) * m : 0)) * dpr, 22 * dpr, 0, TAU); ctx.fill();
    }
  }
}

function glow(ctx, color, r, s) {
  ctx.shadowColor = color;
  ctx.shadowBlur = s * 0.35;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  lines.push(cur);
  const top = y - ((lines.length - 1) * lh) / 2 + lh * 0.35;
  lines.forEach((l, i) => ctx.fillText(l, x, top + i * lh));
}

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(h, k) {
  const [r, g, b] = hex(h);
  const f = (v) => Math.round(clamp(k < 0 ? v * (1 + k) : v + (255 - v) * k, 0, 255));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

