// Sauvegarde locale (navigateur). Tout est protégé : le jeu marche même sans stockage.

import { DUNGEONS } from './data.js';

const KEY = 'brumeval-save-v1';

export function newWorld() {
  return { seed: Math.random().toString(36).slice(2, 10), cleared: DUNGEONS.map(() => false) };
}

export function loadSave() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* stockage indisponible */ }
  if (!s || typeof s !== 'object') s = {};
  return {
    name: typeof s.name === 'string' ? s.name : '',
    cls: s.cls || 'guerrier',
    bots: Number.isInteger(s.bots) ? s.bots : 1,
    chars: s.chars && typeof s.chars === 'object' ? s.chars : {},
    world: s.world && s.world.seed ? s.world : newWorld(),
  };
}

export function storeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* stockage indisponible */ }
}
