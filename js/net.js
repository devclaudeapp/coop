// Transport réseau. Deux implémentations avec la même interface :
//  - PeerJS (WebRTC pair-à-pair, serveur de mise en relation public et gratuit) pour jouer en ligne ;
//  - BroadcastChannel pour tester à plusieurs onglets sur la même machine (?local=1).
// Une connexion expose : send(obj), onMessage(fn), onClose(fn), close().

import { randomCode } from './util.js';

const PREFIX = 'brumeval-coop-v1-';

function wrapPeerConn(dc) {
  let closed = false;
  const closeFns = [];
  const fireClose = () => { if (closed) return; closed = true; closeFns.forEach((f) => f()); };
  dc.on('close', fireClose);
  dc.on('error', fireClose);
  return {
    send(obj) { if (!closed && dc.open) dc.send(obj); },
    onMessage(fn) { dc.on('data', fn); },
    onClose(fn) { closeFns.push(fn); },
    close() { try { dc.close(); } catch { /* déjà fermée */ } fireClose(); },
  };
}

function needPeer() {
  if (!window.Peer) throw new Error('PeerJS n’a pas pu être chargé.');
}

export async function hostRoom({ local, onConnection }) {
  if (local) return hostLocal(onConnection);
  needPeer();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const res = await new Promise((resolve, reject) => {
      const peer = new window.Peer(PREFIX + code, { debug: 1 });
      const timer = setTimeout(() => { peer.destroy(); reject(new Error('Le serveur de mise en relation ne répond pas.')); }, 15000);
      peer.on('open', () => { clearTimeout(timer); resolve(peer); });
      peer.on('error', (err) => {
        clearTimeout(timer);
        if (err.type === 'unavailable-id') { peer.destroy(); resolve(null); }
        else if (!peer.open) { peer.destroy(); reject(new Error('Connexion impossible : ' + err.type)); }
        else console.warn('PeerJS', err);
      });
    });
    if (!res) continue;
    const peer = res;
    peer.on('connection', (dc) => dc.on('open', () => onConnection(wrapPeerConn(dc))));
    // Si le serveur de signalisation coupe, les parties en cours continuent ; on se reconnecte pour accepter de nouveaux joueurs.
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1000); });
    return { code, close: () => peer.destroy() };
  }
  throw new Error('Impossible de réserver un code de partie.');
}

export async function joinRoom({ local, code }) {
  code = code.trim().toUpperCase();
  if (local) return joinLocal(code);
  needPeer();
  return new Promise((resolve, reject) => {
    const peer = new window.Peer({ debug: 1 });
    const fail = (msg) => { clearTimeout(timer); peer.destroy(); reject(new Error(msg)); };
    const timer = setTimeout(() => fail('Délai dépassé : la partie est introuvable ou votre réseau bloque la connexion.'), 20000);
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') fail('Aucune partie avec ce code.');
      else fail('Connexion impossible : ' + err.type);
    });
    peer.on('open', () => {
      const dc = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      dc.on('open', () => {
        clearTimeout(timer);
        const conn = wrapPeerConn(dc);
        conn.onClose(() => peer.destroy());
        resolve(conn);
      });
    });
  });
}

// ───────────── Transport local (BroadcastChannel) ─────────────

function hostLocal(onConnection) {
  const code = randomCode();
  const bc = new BroadcastChannel(PREFIX + code);
  const conns = new Map();
  bc.onmessage = (ev) => {
    const m = ev.data;
    if (m.k === 'join' && !conns.has(m.from)) {
      const handlers = { msg: [], close: [] };
      const conn = {
        send(obj) { bc.postMessage({ k: 'd', to: m.from, data: obj }); },
        onMessage(fn) { handlers.msg.push(fn); },
        onClose(fn) { handlers.close.push(fn); },
        close() { bc.postMessage({ k: 'bye', to: m.from }); handlers.close.forEach((f) => f()); conns.delete(m.from); },
        handlers,
      };
      conns.set(m.from, conn);
      bc.postMessage({ k: 'accept', to: m.from });
      onConnection(conn);
    } else if (m.k === 'd' && m.to === 'host') {
      conns.get(m.from)?.handlers.msg.forEach((f) => f(m.data));
    } else if (m.k === 'bye' && m.to === 'host') {
      const c = conns.get(m.from);
      if (c) { conns.delete(m.from); c.handlers.close.forEach((f) => f()); }
    }
  };
  window.addEventListener('beforeunload', () => conns.forEach((_, id) => bc.postMessage({ k: 'bye', to: id })));
  return Promise.resolve({ code, close: () => { conns.forEach((c) => c.close()); bc.close(); } });
}

function joinLocal(code) {
  const bc = new BroadcastChannel(PREFIX + code);
  const me = Math.random().toString(36).slice(2);
  const handlers = { msg: [], close: [] };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { bc.close(); reject(new Error('Aucune partie locale avec ce code.')); }, 4000);
    bc.onmessage = (ev) => {
      const m = ev.data;
      if (m.to !== me) return;
      if (m.k === 'accept') {
        clearTimeout(timer);
        resolve({
          send(obj) { bc.postMessage({ k: 'd', from: me, to: 'host', data: obj }); },
          onMessage(fn) { handlers.msg.push(fn); },
          onClose(fn) { handlers.close.push(fn); },
          close() { bc.postMessage({ k: 'bye', from: me, to: 'host' }); bc.close(); },
        });
      } else if (m.k === 'd') handlers.msg.forEach((f) => f(m.data));
      else if (m.k === 'bye') handlers.close.forEach((f) => f());
    };
    window.addEventListener('beforeunload', () => bc.postMessage({ k: 'bye', from: me, to: 'host' }));
    bc.postMessage({ k: 'join', from: me });
  });
}
