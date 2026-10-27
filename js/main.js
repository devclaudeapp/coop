// Point d'entrée : menus, démarrage solo / hôte / client, boucle de jeu.

import { CLASSES, CLASS_IDS, MAX_PARTY } from './data.js';
import { Sim } from './sim.js';
import { ClientGame } from './client.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { hostRoom, joinRoom } from './net.js';
import { loadSave, storeSave, newWorld } from './save.js';
import { r2 } from './util.js';

const STEP = 1 / 60;
const BOT_NAMES = ['Aldric', 'Brune', 'Céleste', 'Doran'];
const params = new URLSearchParams(location.search);
const LOCAL = params.get('local') === '1';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const save = loadSave();

let mode = null;          // 'solo' | 'host' | 'client'
let sim = null, client = null, room = null, conn = null;
let meId = null;
const conns = new Map();  // id joueur -> connexion (hôte)
let netFx = [];
let showMap = false, paused = false, running = false;
let lastSeen = null;      // dernières données de personnage connues (client)

// ───────────── Menu ─────────────

$('name').value = save.name;
$('bots').value = String(Math.min(3, Math.max(0, save.bots)));
if (params.get('join')) $('code').value = params.get('join').toUpperCase();

function renderClasses() {
  $('classes').innerHTML = '';
  for (const id of CLASS_IDS) {
    const c = CLASSES[id];
    const ch = save.chars[id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cls' + (save.cls === id ? ' sel' : '');
    b.style.setProperty('--c', c.color);
    b.setAttribute('aria-pressed', save.cls === id ? 'true' : 'false');
    b.innerHTML = `
      <span class="t"><span class="dot"></span>${c.name}</span>
      <span class="role">${c.role}</span>
      <span class="lvl">${ch ? `Niveau ${ch.level}` : 'Nouveau'} · ${c.hp} PV</span>
      <ul><li>${c.atk.name}</li><li>${c.s1.name} — ${c.s1.desc}</li><li>${c.s2.name} — ${c.s2.desc}</li></ul>`;
    b.onclick = () => { save.cls = id; renderClasses(); };
    $('classes').appendChild(b);
  }
}
renderClasses();

function status(text) { $('status').textContent = text || ''; }

function readMenu() {
  save.name = $('name').value.trim().slice(0, 16) || 'Héros';
  save.bots = +$('bots').value;
  storeSave(save);
}

function setBusy(b) { for (const id of ['btn-solo', 'btn-host', 'btn-join']) $(id).disabled = b; }

$('btn-solo').onclick = () => { readMenu(); startLocal('solo'); };

$('btn-host').onclick = async () => {
  readMenu();
  setBusy(true);
  status('Création de la partie…');
  try {
    startLocal('host');
    room = await hostRoom({ local: LOCAL, onConnection: acceptConnection });
    $('hostbar-code').textContent = room.code;
    $('hostbar').classList.remove('hidden');
    sim.msg(`Partie créée ! Code : ${room.code}`, '#80deea');
  } catch (err) {
    stopGame();
    status(err.message);
  }
  setBusy(false);
};

$('btn-join').onclick = async () => {
  readMenu();
  const code = $('code').value.trim().toUpperCase();
  if (code.length < 4) return status('Entrez le code de la partie (5 caractères).');
  setBusy(true);
  status('Connexion à la partie…');
  try {
    conn = await joinRoom({ local: LOCAL, code });
    startClient(code);
  } catch (err) {
    status(err.message);
  }
  setBusy(false);
};

$('btn-reset').onclick = () => {
  if (!confirm('Recommencer un nouveau monde ? Les donjons terminés seront oubliés (vos personnages gardent leur niveau).')) return;
  save.world = newWorld();
  storeSave(save);
  status('Nouveau monde généré.');
};

$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

function inviteLink() {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('join', room.code);
  if (LOCAL) u.searchParams.set('local', '1');
  return u.toString();
}

async function copyInvite(btn) {
  const link = inviteLink();
  try { await navigator.clipboard.writeText(link); btn.textContent = 'Lien copié !'; }
  catch { prompt('Copiez ce lien :', link); }
  setTimeout(() => { btn.textContent = btn.id === 'btn-copy' ? 'Copier le lien d’invitation' : 'Copier le lien'; }, 1600);
}
$('hostbar-copy').onclick = (e) => copyInvite(e.currentTarget);
$('btn-copy').onclick = (e) => copyInvite(e.currentTarget);

$('btn-resume').onclick = () => setPaused(false);
$('btn-quit').onclick = () => { stopGame(); };

function setPaused(p) {
  paused = p;
  $('pause').classList.toggle('hidden', !p);
  $('pause-note').textContent = mode === 'solo' ? 'Le jeu est en pause.' : 'En coop, la partie continue pendant que ce menu est ouvert.';
  $('pause-share').classList.toggle('hidden', !(mode === 'host' && room));
  if (room) $('pause-code').textContent = room.code;
}

// ───────────── Démarrage ─────────────

function pickBotClasses(n, mine) {
  const order = ['clerc', 'guerrier', 'mage', 'rodeur'].filter((c) => c !== mine);
  return order.slice(0, n);
}

function startLocal(m) {
  mode = m;
  sim = new Sim({ worldSeed: save.world.seed, cleared: save.world.cleared });
  const me = sim.addPlayer({ name: save.name, cls: save.cls, char: save.chars[save.cls] });
  meId = me.id;
  pickBotClasses(Math.min(save.bots, MAX_PARTY - 1), save.cls).forEach((cls, i) => {
    sim.addPlayer({ name: BOT_NAMES[i], cls, bot: true });
  });
  beginLoop();
}

function acceptConnection(c) {
  let pid = null;
  c.lastMsg = performance.now();
  c.onMessage((m) => {
    c.lastMsg = performance.now();
    if (!sim || !m || typeof m !== 'object') return;
    if (m.t === 'hello' && pid == null) {
      if (!sim.canJoin()) { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); return; }
      const p = sim.addPlayer({ name: m.name, cls: m.cls, char: m.char, remote: true });
      pid = p.id;
      conns.set(pid, c);
      c.send({ t: 'welcome', you: pid, seed: sim.worldSeed });
      sim.msg(`${p.name} a rejoint la partie !`, '#b9f6ca');
    } else if (m.t === 'in' && pid != null) {
      const p = sim.player(pid);
      if (!p || !Array.isArray(m.f)) return;
      for (const f of m.f.slice(0, 40)) if (Array.isArray(f) && f.length === 4) p.moveQ.push(f.map(Number));
      p.input.aim = +m.a || 0;
      p.input.b = m.b | 0;
      const last = m.f[m.f.length - 1];
      if (last) { p.input.mx = +last[1] || 0; p.input.my = +last[2] || 0; }
    }
  });
  c.onClose(() => {
    if (pid == null || !sim) return;
    const p = sim.player(pid);
    if (p) { sim.msg(`${p.name} a quitté la partie.`, '#ffab91'); sim.removePlayer(pid); }
    conns.delete(pid);
  });
}

function startClient(code) {
  mode = 'client';
  conn.send({ t: 'hello', name: save.name, cls: save.cls, char: save.chars[save.cls] });
  conn.onMessage((m) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'welcome') {
      client = new ClientGame({ worldSeed: m.seed, you: m.you });
      meId = m.you;
      status('');
      beginLoop();
      renderer.toast(`Connecté à la partie ${code}`, '#80deea');
    } else if (m.t === 'snap' && client) {
      client.onSnap(m);
    } else if (m.t === 'full') {
      status('Cette partie est complète (4 joueurs).');
    }
  });
  conn.onClose(() => {
    if (mode !== 'client') return;
    stopGame();
    status('La connexion avec l’hôte a été perdue.');
  });
}

function stopGame() {
  persist();
  running = false;
  if (room) { room.close(); room = null; }
  if (conn) { const c = conn; conn = null; mode = null; c.close(); }
  conns.clear();
  sim = null; client = null; mode = null; meId = null; netFx = []; lastSeen = null;
  showMap = false;
  setPaused(false);
  $('hostbar').classList.add('hidden');
  $('menu').classList.remove('hidden');
  renderClasses();
}

function persist() {
  if (sim) {
    const me = sim.player(meId);
    if (me) save.chars[me.cls] = sim.charData(me);
    save.world.cleared = sim.cleared.slice();
  } else if (lastSeen) {
    save.chars[lastSeen.cls] = lastSeen.data;
  }
  storeSave(save);
}
addEventListener('beforeunload', persist);
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

// ───────────── Boucle ─────────────

let last = 0, acc = 0, sendT = 0, snapT = 0, saveT = 0, pendingB = 0;

function beginLoop() {
  $('menu').classList.add('hidden');
  status('');
  last = performance.now();
  acc = 0;
  pendingB = 0;
  if (!running) { running = true; requestAnimationFrame(frame); }
}

function frame(now) {
  if (!running) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  for (const a of input.takeActions()) {
    if (a === 'map') showMap = !showMap;
    if (a === 'pause') setPaused(!paused);
  }
  const inp = input.sample(innerWidth / 2, innerHeight / 2);
  if (paused) { inp.mx = 0; inp.my = 0; inp.b = 0; }
  let view = null;

  if (sim) {
    const me = sim.player(meId);
    pendingB |= inp.b;
    if (me) Object.assign(me.input, { mx: inp.mx, my: inp.my, aim: inp.aim, b: pendingB });
    if (!(paused && mode === 'solo')) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 6) {
        sim.step(STEP);
        acc -= STEP;
        steps++;
        if (me) me.input.b = inp.b;
      }
      if (steps) pendingB = 0;
    }
    const fx = sim.drainFx();
    renderer.addFx(fx, meId);
    if (mode === 'host' && conns.size) {
      // Un joueur silencieux depuis 8 s (onglet fermé, réseau coupé) est retiré.
      for (const c of conns.values()) if (now - c.lastMsg > 8000) c.close();
      netFx.push(...fx);
      snapT += dt;
      if (snapT >= 0.05) {
        snapT = 0;
        const s = sim.snapshot();
        s.F = netFx;
        netFx = [];
        for (const c of conns.values()) c.send(s);
      }
    }
    if (!renderer.map || renderer.map.id !== sim.mapId || renderer.map !== sim.map) renderer.setMap(sim.map);
    view = sim.view();
  } else if (client) {
    if (client.latestRecv && performance.now() / 1000 - client.latestRecv > 10) {
      stopGame();
      status('L’hôte ne répond plus : la partie est terminée.');
      return;
    }
    client.predict(inp.mx, inp.my, dt);
    pendingB |= inp.b;
    sendT += dt;
    if (sendT >= 1 / 30 && conn) {
      sendT = 0;
      conn.send({ t: 'in', f: client.takeOutgoing(), a: r2(inp.aim), b: pendingB });
      pendingB = 0;
    }
    renderer.addFx(client.drainFx(), meId);
    if (client.map && renderer.map !== client.map) renderer.setMap(client.map);
    view = client.view(dt, inp.aim);
    const me = client.me;
    if (me) lastSeen = { cls: me.cls, data: { level: me.level, xp: me.xp, gems: me.gems, hearts: me.hearts, potions: me.potions } };
  }

  saveT += dt;
  if (saveT > 10) { saveT = 0; persist(); }

  if (view && renderer.map) {
    renderer.draw(view, meId, dt, { showMap, code: room ? room.code : null, device: input.device, touch: input.touch });
  } else {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#120f1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  input.touchButtons = renderer.touchButtons;
  requestAnimationFrame(frame);
}

// Pour les tests automatisés et le débogage dans la console.
window.__game = { get sim() { return sim; }, get client() { return client; }, get mode() { return mode; }, get room() { return room; }, renderer, input };
