// ============================================================
// utils/gunDb.js — Gun & Health System
// Stores gun inventory in data/guns.json
// Stores player health in data/health.json
// ============================================================

const fs   = require('fs');
const path = require('path');

const GUNS_FILE   = path.join(__dirname, '../data/guns.json');
const HEALTH_FILE = path.join(__dirname, '../data/health.json');

// ============================================================
// MAX HP
// ============================================================
const MAX_HP = 100;

// ============================================================
// GUN SHOP — all available weapons
// ============================================================
const DEFAULT_GUN_SHOP = {
  guns: [
    // ── PISTOLS ──────────────────────────────────────────────
    {
      id:       'glock',
      name:     'Glock 17',
      emoji:    '🔫',
      desc:     'Reliable semi-auto sidearm. The starter weapon of choice.',
      type:     'Pistol',
      rarity:   'Common',
      price:    500,
      damage:   [8, 15],
      accuracy: 0.72,
      fireRate: 'Semi',
      capacity: 17,
      enabled:  true,
    },
    {
      id:       'desert_eagle',
      name:     'Desert Eagle',
      emoji:    '🔫',
      desc:     'Powerful hand cannon. High damage, low accuracy.',
      type:     'Pistol',
      rarity:   'Uncommon',
      price:    1500,
      damage:   [20, 35],
      accuracy: 0.55,
      fireRate: 'Semi',
      capacity: 7,
      enabled:  true,
    },
    // ── SMGS ─────────────────────────────────────────────────
    {
      id:       'uzi',
      name:     'Uzi',
      emoji:    '💨',
      desc:     'Compact and fast. Great for close-range chaos.',
      type:     'SMG',
      rarity:   'Common',
      price:    1200,
      damage:   [6, 12],
      accuracy: 0.60,
      fireRate: 'Auto',
      capacity: 32,
      enabled:  true,
    },
    {
      id:       'mp5',
      name:     'MP5',
      emoji:    '💨',
      desc:     'Balanced SMG used by professionals worldwide.',
      type:     'SMG',
      rarity:   'Uncommon',
      price:    2200,
      damage:   [10, 18],
      accuracy: 0.70,
      fireRate: 'Auto',
      capacity: 30,
      enabled:  true,
    },
    // ── RIFLES ───────────────────────────────────────────────
    {
      id:       'ak47',
      name:     'AK-47',
      emoji:    '🪖',
      desc:     'Iconic assault rifle. Powerful and brutally reliable.',
      type:     'Rifle',
      rarity:   'Rare',
      price:    4000,
      damage:   [18, 30],
      accuracy: 0.65,
      fireRate: 'Auto',
      capacity: 30,
      enabled:  true,
    },
    {
      id:       'm4a1',
      name:     'M4A1',
      emoji:    '🪖',
      desc:     'Military-grade rifle. High accuracy with serious stopping power.',
      type:     'Rifle',
      rarity:   'Rare',
      price:    5500,
      damage:   [20, 32],
      accuracy: 0.78,
      fireRate: 'Auto',
      capacity: 30,
      enabled:  true,
    },
    // ── SHOTGUNS ─────────────────────────────────────────────
    {
      id:       'pump_shotgun',
      name:     'Pump Shotgun',
      emoji:    '💥',
      desc:     'One shot, one message. Devastating at close range.',
      type:     'Shotgun',
      rarity:   'Uncommon',
      price:    2000,
      damage:   [25, 45],
      accuracy: 0.50,
      fireRate: 'Pump',
      capacity: 8,
      enabled:  true,
    },
    {
      id:       'spas12',
      name:     'SPAS-12',
      emoji:    '💥',
      desc:     'Combat shotgun that means business. Semi-auto with brutal spread.',
      type:     'Shotgun',
      rarity:   'Epic',
      price:    7000,
      damage:   [30, 55],
      accuracy: 0.55,
      fireRate: 'Semi',
      capacity: 9,
      enabled:  true,
    },
    // ── SNIPERS ──────────────────────────────────────────────
    {
      id:       'awp',
      name:     'AWP',
      emoji:    '🎯',
      desc:     'One shot. One kill. The most feared weapon in the shop.',
      type:     'Sniper',
      rarity:   'Epic',
      price:    10000,
      damage:   [55, 80],
      accuracy: 0.90,
      fireRate: 'Bolt',
      capacity: 5,
      enabled:  true,
    },
    // ── HEAVY ────────────────────────────────────────────────
    {
      id:       'rpg',
      name:     'RPG-7',
      emoji:    '🚀',
      desc:     'Rocket-propelled destruction. If they see you coming, it\'s already too late.',
      type:     'Heavy',
      rarity:   'Legendary',
      price:    25000,
      damage:   [70, 100],
      accuracy: 0.80,
      fireRate: 'Single',
      capacity: 1,
      enabled:  true,
    },
    {
      id:       'minigun',
      name:     'Minigun',
      emoji:    '🚀',
      desc:     'Spins up and tears through anything in its path. Mythic firepower.',
      type:     'Heavy',
      rarity:   'Mythic',
      price:    75000,
      damage:   [15, 25],
      accuracy: 0.60,
      fireRate: 'Minigun',
      capacity: 200,
      enabled:  true,
    },
  ],
};

// ============================================================
// GUN SHOP HELPERS
// ============================================================
const GUN_SHOP_FILE = path.join(__dirname, '../data/gunShop.json');

function getGunShop() {
  try {
    if (!fs.existsSync(GUN_SHOP_FILE)) {
      fs.writeFileSync(GUN_SHOP_FILE, JSON.stringify(DEFAULT_GUN_SHOP, null, 2));
      return DEFAULT_GUN_SHOP;
    }
    return JSON.parse(fs.readFileSync(GUN_SHOP_FILE, 'utf8'));
  } catch { return DEFAULT_GUN_SHOP; }
}

function getGunById(gunId) {
  const shop = getGunShop();
  return shop.guns.find(g => g.id === gunId) || null;
}

// ============================================================
// GUN INVENTORY — per user
// Structure: { userId: [{ gunId, boughtAt, ammo }] }
// ============================================================
function readGuns() {
  try { return fs.existsSync(GUNS_FILE) ? JSON.parse(fs.readFileSync(GUNS_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function writeGuns(data) { fs.writeFileSync(GUNS_FILE, JSON.stringify(data, null, 2)); }

function getGunInventory(userId) {
  return readGuns()[userId] || [];
}

function saveGunInventory(userId, inv) {
  const all = readGuns();
  all[userId] = inv;
  writeGuns(all);
}

// ============================================================
// HEALTH SYSTEM
// Structure: { userId: { hp, status, deathCount, hospitalUntil, lastUpdated } }
// ============================================================
function readHealth() {
  try { return fs.existsSync(HEALTH_FILE) ? JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function writeHealth(data) { fs.writeFileSync(HEALTH_FILE, JSON.stringify(data, null, 2)); }

function getHealth(userId) {
  const all = readHealth();
  if (!all[userId]) {
    all[userId] = { hp: MAX_HP, status: 'alive', deathCount: 0, hospitalUntil: null, lastUpdated: Date.now() };
    writeHealth(all);
  }
  return all[userId];
}

function saveHealth(userId, data) {
  const all = readHealth();
  all[userId] = data;
  writeHealth(all);
}

// ============================================================
// STATUS — label, color, and description based on HP
// ============================================================
function getStatus(hp) {
  if (hp <= 0)   return { label: '💀 Dead',     color: 0x111111, desc: 'You\'re down. Wait it out or visit a hospital.' };
  if (hp <= 20)  return { label: '🩸 Critical',  color: 0xff0000, desc: 'Barely breathing. One more hit and you\'re done.' };
  if (hp <= 40)  return { label: '🤕 Injured',   color: 0xff6600, desc: 'Hurting bad. Use a medkit ASAP.' };
  if (hp <= 60)  return { label: '😤 Damaged',   color: 0xf5c518, desc: 'Taken some hits but still standing.' };
  if (hp <= 80)  return { label: '💪 Healthy',   color: 0x2ecc71, desc: 'In decent shape. Keep your guard up.' };
  return           { label: '🟢 Full Health', color: 0x00ff88, desc: 'Locked and loaded at full health.' };
}

module.exports = {
  MAX_HP,
  getGunShop,
  getGunById,
  getGunInventory,
  saveGunInventory,
  getHealth,
  saveHealth,
  getStatus,
};
