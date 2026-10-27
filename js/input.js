// Entrées : clavier + souris, manette, et commandes tactiles (doubles joysticks).
// Les codes physiques (event.code) rendent ZQSD (AZERTY) et WASD (QWERTY) équivalents.

export const BTN = { ATK: 1, S1: 2, S2: 4, POT: 8 };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, l: false, r: false };
    this.latched = 0;
    this.device = 'kb';
    this.touch = { move: null, aim: null, held: new Set() };
    this.touchButtons = [];
    this.actions = [];
    this.padPrev = [];
    this.lastAim = 0;

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab') e.preventDefault();
      this.device = 'kb';
      if (!e.repeat) {
        if (e.code === 'Space') this.latched |= BTN.S1;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') this.latched |= BTN.S2;
        if (e.code === 'KeyR' || e.code === 'Digit1' || e.code === 'Numpad1') this.latched |= BTN.POT;
        if (e.code === 'Tab' || e.key === 'm' || e.key === 'M') this.actions.push('map');
        if (e.code === 'Escape') this.actions.push('pause');
      }
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });

    canvas.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.device = 'kb'; });
    canvas.addEventListener('mousedown', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.device = 'kb';
      if (e.button === 0) this.mouse.l = true;
      if (e.button === 2) { this.mouse.r = true; this.latched |= BTN.S1; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.l = false;
      if (e.button === 2) this.mouse.r = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const opts = { passive: false };
    canvas.addEventListener('touchstart', (e) => this.onTouch(e, 'start'), opts);
    canvas.addEventListener('touchmove', (e) => this.onTouch(e, 'move'), opts);
    canvas.addEventListener('touchend', (e) => this.onTouch(e, 'end'), opts);
    canvas.addEventListener('touchcancel', (e) => this.onTouch(e, 'end'), opts);
  }

  onTouch(e, phase) {
    e.preventDefault();
    this.device = 'touch';
    const W = innerWidth;
    for (const t of e.changedTouches) {
      const x = t.clientX, y = t.clientY, id = t.identifier;
      if (phase === 'start') {
        const btn = this.touchButtons.find((b) => Math.hypot(b.x - x, b.y - y) < b.r * 1.15);
        if (btn) {
          if (btn.id === 's1') this.latched |= BTN.S1;
          else if (btn.id === 's2') this.latched |= BTN.S2;
          else if (btn.id === 'pot') this.latched |= BTN.POT;
          else this.actions.push(btn.id);
          this.touch.held.add(id);
          continue;
        }
        if (x < W * 0.45 && !this.touch.move) this.touch.move = { id, ox: x, oy: y, x, y };
        else if (!this.touch.aim) this.touch.aim = { id, ox: x, oy: y, x, y };
      } else if (phase === 'move') {
        for (const s of [this.touch.move, this.touch.aim]) if (s && s.id === id) { s.x = x; s.y = y; }
      } else {
        if (this.touch.move && this.touch.move.id === id) this.touch.move = null;
        if (this.touch.aim && this.touch.aim.id === id) this.touch.aim = null;
        this.touch.held.delete(id);
      }
    }
  }

  takeActions() { const a = this.actions; this.actions = []; return a; }

  // Renvoie { mx, my, aim, b } ; (px, py) = position écran du joueur en pixels CSS.
  sample(px, py) {
    let mx = 0, my = 0, aim = this.lastAim, b = this.latched;
    this.latched = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) my -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (this.mouse.l || k.has('KeyJ')) b |= BTN.ATK;
    if (this.mouse.r || k.has('Space') || k.has('KeyK')) b |= BTN.S1;
    if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyE') || k.has('KeyL')) b |= BTN.S2;
    if (this.device === 'kb') aim = Math.atan2(this.mouse.y - py, this.mouse.x - px);

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const dz = (v) => (Math.abs(v) < 0.2 ? 0 : v);
      const lx = dz(pad.axes[0] || 0), ly = dz(pad.axes[1] || 0);
      const rx = dz(pad.axes[2] || 0), ry = dz(pad.axes[3] || 0);
      const pressed = (i) => pad.buttons[i] && pad.buttons[i].pressed;
      const any = lx || ly || rx || ry || pad.buttons.some((x) => x.pressed);
      if (!any) continue;
      this.device = 'pad';
      mx += lx; my += ly;
      if (Math.hypot(rx, ry) > 0.5) { aim = Math.atan2(ry, rx); b |= BTN.ATK; }
      else if (lx || ly) aim = Math.atan2(ly, lx);
      if (pressed(7) || pressed(0)) b |= BTN.ATK;
      if (pressed(4) || pressed(6) || pressed(1)) b |= BTN.S1;
      if (pressed(5)) b |= BTN.S2;
      const prev = this.padPrev;
      if ((pressed(2) || pressed(3)) && !prev[2]) b |= BTN.POT;
      if (pressed(8) && !prev[8]) this.actions.push('map');
      if (pressed(9) && !prev[9]) this.actions.push('pause');
      this.padPrev = { 2: pressed(2) || pressed(3), 8: pressed(8), 9: pressed(9) };
      break;
    }

    const tm = this.touch.move, ta = this.touch.aim;
    if (tm) {
      const dx = tm.x - tm.ox, dy = tm.y - tm.oy, l = Math.hypot(dx, dy);
      if (l > 8) { const s = Math.min(1, l / 50); mx += (dx / l) * s; my += (dy / l) * s; }
    }
    if (ta) {
      const dx = ta.x - ta.ox, dy = ta.y - ta.oy;
      if (Math.hypot(dx, dy) > 10) aim = Math.atan2(dy, dx);
      b |= BTN.ATK;
    } else if (this.device === 'touch' && (mx || my)) aim = Math.atan2(my, mx);

    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    this.lastAim = aim;
    return { mx, my, aim, b };
  }
}
