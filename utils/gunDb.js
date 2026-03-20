// ============================================================
// utils/gunDb.js — MongoDB Edition
// Collections: gunInventory, health
// Gun shop config stored in MongoDB (collection: gunShop)
// ============================================================

const { col } = require('./mongo');

const MAX_HP = 100;

// ── GUN SHOP ──────────────────────────────────────────────────

const DEFAULT_GUNS = [
  { id:'glock',        name:'Glock 17',     emoji:'🔫', desc:'Reliable semi-auto sidearm.',                    type:'Pistol',  rarity:'Common',    price:500,   damage:[8,15],   accuracy:0.72, fireRate:'Semi',    capacity:17,  enabled:true },
  { id:'desert_eagle', name:'Desert Eagle', emoji:'🔫', desc:'Powerful hand cannon. High damage, low accuracy.',type:'Pistol',  rarity:'Uncommon',  price:1500,  damage:[20,35],  accuracy:0.55, fireRate:'Semi',    capacity:7,   enabled:true },
  { id:'uzi',          name:'Uzi',          emoji:'💨', desc:'Compact and fast. Great for close-range chaos.',  type:'SMG',     rarity:'Common',    price:1200,  damage:[6,12],   accuracy:0.60, fireRate:'Auto',    capacity:32,  enabled:true },
  { id:'mp5',          name:'MP5',          emoji:'💨', desc:'Balanced SMG used by professionals worldwide.',   type:'SMG',     rarity:'Uncommon',  price:2200,  damage:[10,18],  accuracy:0.70, fireRate:'Auto',    capacity:30,  enabled:true },
  { id:'ak47',         name:'AK-47',        emoji:'🪖', desc:'Iconic assault rifle. Powerful and reliable.',    type:'Rifle',   rarity:'Rare',      price:4000,  damage:[18,30],  accuracy:0.65, fireRate:'Auto',    capacity:30,  enabled:true },
  { id:'m4a1',         name:'M4A1',         emoji:'🪖', desc:'Military-grade rifle. High accuracy.',            type:'Rifle',   rarity:'Rare',      price:5500,  damage:[20,32],  accuracy:0.78, fireRate:'Auto',    capacity:30,  enabled:true },
  { id:'pump_shotgun', name:'Pump Shotgun', emoji:'💥', desc:'One shot, one message.',                          type:'Shotgun', rarity:'Uncommon',  price:2000,  damage:[25,45],  accuracy:0.50, fireRate:'Pump',    capacity:8,   enabled:true },
  { id:'spas12',       name:'SPAS-12',      emoji:'💥', desc:'Combat shotgun. Semi-auto with brutal spread.',   type:'Shotgun', rarity:'Epic',      price:7000,  damage:[30,55],  accuracy:0.55, fireRate:'Semi',    capacity:9,   enabled:true },
  { id:'awp',          name:'AWP',          emoji:'🎯', desc:'One shot. One kill.',                             type:'Sniper',  rarity:'Epic',      price:10000, damage:[55,80],  accuracy:0.90, fireRate:'Bolt',    capacity:5,   enabled:true },
  { id:'rpg',          name:'RPG-7',        emoji:'🚀', desc:'Rocket-propelled destruction.',                   type:'Heavy',   rarity:'Legendary', price:25000, damage:[70,100], accuracy:0.80, fireRate:'Single',  capacity:1,   enabled:true },
  { id:'minigun',      name:'Minigun',      emoji:'🚀', desc:'Spins up and tears through anything.',            type:'Heavy',   rarity:'Mythic',    price:75000, damage:[15,25],  accuracy:0.60, fireRate:'Minigun', capacity:200, enabled:true },
];

async function getGunShop() {
  const c   = await col('gunShop');
  const doc = await c.findOne({ _id: 'shop' });
  if (!doc || !doc.guns) {
    await c.updateOne({ _id: 'shop' }, { $set: { guns: DEFAULT_GUNS } }, { upsert: true });
    return { guns: DEFAULT_GUNS };
  }
  return doc;
}

async function getGunById(gunId) {
  const shop = await getGunShop();
  return shop.guns.find(g => g.id === gunId) || null;
}

// ── GUN INVENTORY ─────────────────────────────────────────────

async function getGunInventory(userId) {
  const c   = await col('gunInventory');
  const doc = await c.findOne({ _id: userId });
  return doc?.guns || [];
}

async function saveGunInventory(userId, guns) {
  const c = await col('gunInventory');
  await c.updateOne({ _id: userId }, { $set: { guns } }, { upsert: true });
}

// ── HEALTH ────────────────────────────────────────────────────

async function getHealth(userId) {
  const c   = await col('health');
  const doc = await c.findOne({ _id: userId });
  if (!doc) {
    const fresh = { hp: MAX_HP, status: 'alive', deathCount: 0, hospitalUntil: null, lastUpdated: Date.now() };
    await c.updateOne({ _id: userId }, { $set: fresh }, { upsert: true });
    return fresh;
  }
  return doc;
}

async function saveHealth(userId, data) {
  const c = await col('health');
  const { _id, ...rest } = data;
  await c.updateOne({ _id: userId }, { $set: rest }, { upsert: true });
}

// ── STATUS ────────────────────────────────────────────────────

function getStatus(hp) {
  if (hp <= 0)  return { label:'💀 Dead',       color:0x111111, desc:'You\'re down. Wait it out or visit a hospital.' };
  if (hp <= 20) return { label:'🩸 Critical',    color:0xff0000, desc:'Barely breathing. One more hit and you\'re done.' };
  if (hp <= 40) return { label:'🤕 Injured',     color:0xff6600, desc:'Hurting bad. Use a medkit ASAP.' };
  if (hp <= 60) return { label:'😤 Damaged',     color:0xf5c518, desc:'Taken some hits but still standing.' };
  if (hp <= 80) return { label:'💪 Healthy',     color:0x2ecc71, desc:'In decent shape. Keep your guard up.' };
  return               { label:'🟢 Full Health', color:0x00ff88, desc:'Locked and loaded at full health.' };
}

module.exports = { MAX_HP, getGunShop, getGunById, getGunInventory, saveGunInventory, getHealth, saveHealth, getStatus };
