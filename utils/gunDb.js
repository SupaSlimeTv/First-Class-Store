// ============================================================
// utils/gunDb.js — Gun Shop & Player Health (MongoDB)
// ============================================================
const { col } = require('./mongo');

// ── In-memory caches ──────────────────────────────────────
let _shop      = null; // { guns: [...] }
let _health    = {};
let _inventory = {};

async function preloadGunCache() {
  try {
    const [sc, hc, ic] = await Promise.all([col('gunShop'), col('playerHealth'), col('gunInventory')]);
    const [shopDoc, health, inventory] = await Promise.all([
      sc.findOne({ _id: 'shop' }),
      hc.find({}).toArray(),
      ic.find({}).toArray(),
    ]);
    _shop      = shopDoc ? { guns: shopDoc.guns || DEFAULT_GUNS } : { guns: [...DEFAULT_GUNS] };
    _health    = Object.fromEntries(health.map(d    => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    _inventory = Object.fromEntries(inventory.map(d => { const id=d._id; const o={...d}; delete o._id; return [id, o.items||[]]; }));
    console.log(`📦 Gun cache loaded (${_shop.guns.length} weapons)`);
  } catch(e) { console.error('preloadGunCache error:', e.message); }
}

// ── GUN SHOP ──────────────────────────────────────────────
function getGunShop() {
  if (!_shop || !_shop.guns || !_shop.guns.length) {
    return { guns: [...DEFAULT_GUNS] };
  }
  return _shop;
}

async function saveGunShop(data) {
  _shop = data;
  try {
    const c = await col('gunShop');
    await c.replaceOne({ _id: 'shop' }, { _id: 'shop', ...data, lastUpdated: Date.now() }, { upsert: true });
  } catch(e) { console.error('saveGunShop error:', e.message); }
}

function getGunById(gunId) {
  const shop = getGunShop();
  return (shop.guns || DEFAULT_GUNS).find(g => g.id === gunId) || null;
}

function getAllGuns() {
  return getGunShop().guns || DEFAULT_GUNS;
}

// ── GUN INVENTORY ─────────────────────────────────────────
function getGunInventory(userId) {
  if (!_inventory[userId]) _inventory[userId] = [];
  return _inventory[userId];
}
function getAllGunInventories()       { return { ..._inventory }; }

async function saveGunInventory(userId, items) {
  _inventory[userId] = items;
  try {
    const c = await col('gunInventory');
    await c.replaceOne({ _id: userId }, { _id: userId, items }, { upsert: true });
  } catch(e) { console.error('saveGunInventory error:', e.message); }
}

// ── PLAYER HEALTH ─────────────────────────────────────────
const MAX_HP = 100;

function getHealth(userId) {
  return _health[userId] || { hp: MAX_HP, status: 'alive', lastUpdated: Date.now(), hospitalUntil: null, deathCount: 0 };
}

function getAllHealth() { return { ..._health }; }

async function saveHealth(userId, data) {
  _health[userId] = data;
  try {
    const c = await col('playerHealth');
    await c.replaceOne({ _id: userId }, { _id: userId, ...data }, { upsert: true });
  } catch(e) { console.error('saveHealth error:', e.message); }
}

function getStatus(hp) {
  if (hp <= 0)  return { label:'💀 Dead',       color:0x222222 };
  if (hp <= 20) return { label:'🩸 Critical',    color:0xff0000 };
  if (hp <= 40) return { label:'🤕 Injured',     color:0xff6600 };
  if (hp <= 60) return { label:'😐 Roughed Up',  color:0xffaa00 };
  if (hp <= 80) return { label:'💪 Healthy',     color:0x88cc00 };
  return              { label:'🟢 Full Health',  color:0x2ecc71 };
}

// ── DEFAULT GUN ROSTER ────────────────────────────────────
const DEFAULT_GUNS = [
  { id:'pipe_pistol',  name:'Pipe Pistol',  emoji:'🔧', type:'Pistol',  damage:[8,18],   price:800,    accuracy:0.65, capacity:6,   fireRate:'Semi',   rarity:'Common',    desc:'Homemade and sketchy.' },
  { id:'glock',        name:'Glock 19',     emoji:'🔫', type:'Pistol',  damage:[15,25],  price:2500,   accuracy:0.75, capacity:15,  fireRate:'Semi',   rarity:'Common',    desc:'Reliable. Concealable. Classic.' },
  { id:'desert_eagle', name:'Desert Eagle', emoji:'🦅', type:'Pistol',  damage:[30,50],  price:7500,   accuracy:0.65, capacity:7,   fireRate:'Semi',   rarity:'Uncommon',  desc:'Heavy. Loud. Disrespectful.' },
  { id:'mac10',        name:'MAC-10',       emoji:'💨', type:'SMG',     damage:[12,20],  price:5000,   accuracy:0.55, capacity:30,  fireRate:'Auto',   rarity:'Uncommon',  desc:'Sprays fast. Aim is questionable.' },
  { id:'uzi',          name:'Uzi',          emoji:'⚡', type:'SMG',     damage:[14,22],  price:6500,   accuracy:0.60, capacity:32,  fireRate:'Auto',   rarity:'Uncommon',  desc:'Iconic. Dangerous.' },
  { id:'ak47',         name:'AK-47',        emoji:'🪖', type:'Rifle',   damage:[35,55],  price:15000,  accuracy:0.72, capacity:30,  fireRate:'Auto',   rarity:'Rare',      desc:'War-proven. The people\'s rifle.' },
  { id:'m4',           name:'M4 Carbine',   emoji:'🎯', type:'Rifle',   damage:[30,50],  price:18000,  accuracy:0.80, capacity:30,  fireRate:'Auto',   rarity:'Rare',      desc:'Military grade.' },
  { id:'shotgun',      name:'Pump Shotgun', emoji:'💥', type:'Shotgun', damage:[40,70],  price:8000,   accuracy:0.50, capacity:8,   fireRate:'Semi',   rarity:'Common',    desc:'Close range nightmare fuel.' },
  { id:'spas12',       name:'SPAS-12',      emoji:'🔥', type:'Shotgun', damage:[55,85],  price:20000,  accuracy:0.55, capacity:8,   fireRate:'Semi',   rarity:'Rare',      desc:'Banned in 18 countries.' },
  { id:'sniper',       name:'Sniper Rifle', emoji:'🔭', type:'Sniper',  damage:[75,100], price:35000,  accuracy:0.90, capacity:5,   fireRate:'Bolt',   rarity:'Epic',      desc:'One shot. Make it count.' },
  { id:'rpg',          name:'RPG-7',        emoji:'🚀', type:'Heavy',   damage:[90,120], price:80000,  accuracy:0.70, capacity:1,   fireRate:'Single', rarity:'Legendary', desc:'Anti-tank. Subtle.' },
  { id:'minigun',      name:'Minigun',      emoji:'🌀', type:'Heavy',   damage:[20,35],  price:150000, accuracy:0.45, capacity:200, fireRate:'Auto',   rarity:'Mythic',    desc:'6,000 rounds per minute.' },
];

module.exports = {
  preloadGunCache,
  getGunShop, saveGunShop, getGunById, getAllGuns, DEFAULT_GUNS,
  getGunInventory, saveGunInventory, getAllGunInventories,
  getHealth, saveHealth, getAllHealth, getStatus, MAX_HP,
};
