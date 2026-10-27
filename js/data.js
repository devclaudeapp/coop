// Données de jeu : tuiles, classes, ennemis, boss, donjons, objets.

export const T = {
  VOID: 0, FLOOR: 1, WALL: 2, GRASS: 3, TREE: 4, WATER: 5, PATH: 6, STAIRS: 7,
  ENTRANCE: 8, EXIT: 9, BRIDGE: 10, HOUSE: 11, FOUNTAIN: 12, LAVA: 13, ROCK: 14,
  FLOWER: 15, PILLAR: 16, CRYSTAL: 17,
};

// Tuiles qui bloquent les déplacements.
export const SOLID = new Uint8Array(32);
for (const t of [T.VOID, T.WALL, T.TREE, T.WATER, T.HOUSE, T.FOUNTAIN, T.LAVA, T.ROCK, T.PILLAR, T.CRYSTAL]) SOLID[t] = 1;

// Tuiles qui arrêtent les projectiles (l'eau et la lave les laissent passer).
export const BLOCK_SHOT = new Uint8Array(32);
for (const t of [T.VOID, T.WALL, T.TREE, T.HOUSE, T.ROCK, T.PILLAR, T.CRYSTAL]) BLOCK_SHOT[t] = 1;

export const CLASS_IDS = ['guerrier', 'rodeur', 'mage', 'clerc'];

export const CLASSES = {
  guerrier: {
    name: 'Guerrier', color: '#d9534f', hp: 150, speed: 4.3,
    role: 'Tank — encaisse, se soigne en frappant',
    atk: { name: 'Taillade', kind: 'melee', dmg: 20, range: 1.55, arc: 2.0, cd: 0.45, lifeOnHit: 0.015 },
    s1: { name: 'Tourbillon', cd: 6, desc: 'Frappe tout autour de vous et repousse.' },
    s2: { name: 'Cri de guerre', cd: 12, desc: 'Attire les ennemis et réduit vos dégâts subis de 50 %.' },
  },
  rodeur: {
    name: 'Rôdeur', color: '#4caf50', hp: 100, speed: 4.9,
    role: 'Distance — rapide et précis',
    atk: { name: 'Flèche', kind: 'shot', dmg: 15, speed: 17, life: 0.6, cd: 0.3, proj: 'arrow' },
    s1: { name: 'Salve', cd: 5, desc: 'Tire cinq flèches en éventail.' },
    s2: { name: 'Roulade', cd: 4, desc: 'Esquive rapide, invulnérable pendant la roulade.' },
  },
  mage: {
    name: 'Mage', color: '#8e6bd6', hp: 95, speed: 4.4,
    role: 'Zone — gros dégâts, fragile',
    atk: { name: 'Projectile arcanique', kind: 'shot', dmg: 18, speed: 12, life: 0.75, cd: 0.48, proj: 'bolt' },
    s1: { name: 'Boule de feu', cd: 5, desc: 'Explose et brûle tous les ennemis proches.' },
    s2: { name: 'Nova de givre', cd: 9, desc: 'Gèle les ennemis autour de vous.' },
  },
  clerc: {
    name: 'Clerc', color: '#f0c419', hp: 120, speed: 4.5,
    role: 'Soutien — soigne, protège, relève vite',
    atk: { name: 'Marteau sacré', kind: 'melee', dmg: 16, range: 1.45, arc: 1.7, cd: 0.5, healOnHit: true },
    s1: { name: 'Lumière apaisante', cd: 8, desc: 'Soigne tout le groupe autour de vous.' },
    s2: { name: 'Égide', cd: 14, desc: 'Bouclier qui absorbe les dégâts des alliés proches.' },
  },
};

// ai : melee | ranged | erratic | charger
export const ENEMIES = {
  slime: { name: 'Slime', hp: 28, speed: 2.2, dmg: 8, r: 0.36, xp: 5, ai: 'melee', reach: 0.5, atkCd: 1.0, color: '#6bd36b' },
  loup: { name: 'Loup', hp: 40, speed: 4.6, dmg: 10, r: 0.38, xp: 9, ai: 'melee', reach: 0.5, atkCd: 0.9, color: '#9aa0a6' },
  gobelin: { name: 'Gobelin', hp: 38, speed: 3.7, dmg: 10, r: 0.34, xp: 9, ai: 'melee', reach: 0.5, atkCd: 0.8, color: '#7cb342' },
  squelette: { name: 'Squelette archer', hp: 42, speed: 2.6, dmg: 12, r: 0.36, xp: 12, ai: 'ranged', range: 7, atkCd: 1.7, proj: 'bone', pspeed: 8, color: '#e8e2cf' },
  chauvesouris: { name: 'Chauve-souris', hp: 20, speed: 5.0, dmg: 6, r: 0.3, xp: 6, ai: 'erratic', reach: 0.4, atkCd: 0.8, color: '#7e57c2' },
  ombre: { name: 'Ombre', hp: 52, speed: 2.4, dmg: 14, r: 0.38, xp: 15, ai: 'ranged', range: 8, atkCd: 2.3, proj: 'orb', pspeed: 6, spread: 3, color: '#5c3d8f' },
  brute: { name: 'Brute', hp: 140, speed: 2.5, dmg: 23, r: 0.55, xp: 30, ai: 'charger', reach: 0.6, atkCd: 1.3, color: '#a1653a' },
  cristal: { name: 'Élémentaire de cristal', hp: 60, speed: 2.2, dmg: 13, r: 0.4, xp: 16, ai: 'ranged', range: 7, atkCd: 1.9, proj: 'shard', pspeed: 9, spread: 2, color: '#4fc3f7' },
  diablotin: { name: 'Diablotin', hp: 44, speed: 4.0, dmg: 13, r: 0.34, xp: 14, ai: 'ranged', range: 6, atkCd: 1.4, proj: 'fire', pspeed: 9, color: '#ff7043' },
  // Boss
  roi_squelette: {
    name: 'Roi Squelette', boss: true, hp: 2400, speed: 2.3, dmg: 18, r: 0.9, xp: 350, ai: 'boss', reach: 0.6, atkCd: 1.4, color: '#e8e2cf',
    patterns: ['ring', 'summon', 'charge', 'ring', 'slam'], adds: ['squelette', 'chauvesouris'], proj: 'bone',
  },
  golem: {
    name: 'Golem de Cristal', boss: true, hp: 3600, speed: 1.9, dmg: 24, r: 1.1, xp: 700, ai: 'boss', reach: 0.7, atkCd: 1.6, color: '#4fc3f7',
    patterns: ['slam', 'spiral', 'summon', 'slam', 'ring'], adds: ['cristal', 'chauvesouris'], proj: 'shard',
  },
  dragon: {
    name: 'Dragon Ancien', boss: true, hp: 5200, speed: 2.1, dmg: 28, r: 1.3, xp: 1200, ai: 'boss', reach: 0.8, atkCd: 1.5, color: '#e53935',
    patterns: ['breath', 'meteor', 'ring', 'charge', 'summon', 'breath', 'spiral'], adds: ['diablotin'], proj: 'fire',
  },
};

export const ENEMY_IDS = Object.keys(ENEMIES);

export const DUNGEONS = [
  {
    name: 'Crypte Oubliée', theme: 'crypt', floors: 2, boss: 'roi_squelette', color: '#b39ddb',
    mobs: ['squelette', 'squelette', 'chauvesouris', 'slime', 'ombre'],
  },
  {
    name: 'Mines Hantées', theme: 'mine', floors: 3, boss: 'golem', color: '#4fc3f7',
    mobs: ['gobelin', 'gobelin', 'cristal', 'chauvesouris', 'brute'],
  },
  {
    name: 'Antre du Dragon', theme: 'lair', floors: 3, boss: 'dragon', color: '#ff7043',
    mobs: ['diablotin', 'diablotin', 'brute', 'ombre', 'squelette'],
  },
];

export const THEMES = {
  crypt: { floor: '#4a4552', floor2: '#433e4b', wall: '#2b2733', wallTop: '#5e566b', accent: '#b39ddb', light: 'rgba(200,180,255,' },
  mine: { floor: '#5a4a3a', floor2: '#524333', wall: '#33281e', wallTop: '#6e5a45', accent: '#4fc3f7', light: 'rgba(255,220,170,' },
  lair: { floor: '#4a2f2a', floor2: '#432a25', wall: '#2a1715', wallTop: '#6b3a30', accent: '#ff7043', light: 'rgba(255,170,120,' },
};

export const ITEMS = {
  potion: { name: 'Potion de soin', color: '#e53935' },
  gem: { name: 'Gemme de puissance (+6 % dégâts)', color: '#ab47bc' },
  heart: { name: 'Cœur de vitalité (+12 PV max)', color: '#ec407a' },
  chest: { name: 'Coffre', color: '#c58b3a' },
  bigchest: { name: 'Coffre du boss', color: '#ffd54f' },
};
export const ITEM_IDS = Object.keys(ITEMS);

export const PROJ_IDS = ['arrow', 'bolt', 'fireball', 'bone', 'orb', 'shard', 'fire'];

export const MAX_PARTY = 4;
export const MAX_POTIONS = 5;

export const xpForLevel = (lvl) => Math.round(40 + lvl * lvl * 18);

export function mapName(mapId) {
  if (mapId === 'world') return 'Vallée de Brumeval';
  const m = /^d(\d)f(\d)$/.exec(mapId);
  if (!m) return mapId;
  const d = DUNGEONS[+m[1]];
  return `${d.name} — Étage ${+m[2] + 1}/${d.floors}`;
}
