// ============================================================
// utils/homeDb.js — Home System Database
// Per-user homes with tiers, furnishings, stash, passive income
// ============================================================
const { col } = require('./mongo');

let _homes = {}; // userId -> home object

const HOME_TIERS = {
  studio:  { name:'🏚️ Studio',  cost:5000,   stashSlots:3,  furnSlots:2,  passivePerHr:50,   desc:'A humble start.' },
  house:   { name:'🏠 House',   cost:25000,  stashSlots:8,  furnSlots:5,  passivePerHr:150,  desc:'Room to grow.' },
  mansion: { name:'🏡 Mansion', cost:100000, stashSlots:20, furnSlots:10, passivePerHr:400,  desc:'Living large.' },
  estate:  { name:'🏰 Estate',  cost:500000, stashSlots:50, furnSlots:20, passivePerHr:1200, desc:'Untouchable.' },
};

const UPGRADE_PATH = ['studio','house','mansion','estate'];

// Default furniture shop items (admin can add more via store with isFurniture flag)
const FURNITURE_SHOP = [
  { id:'safe',        name:'🔒 Safe',          cost:5000,  passiveBonus:0,   stashBonus:5,  desc:'Adds 5 stash slots.' },
  { id:'security_cam',name:'📷 Security Camera',cost:8000,  passiveBonus:0,   stashBonus:0,  desc:'Warns you when searched.' },
  { id:'drug_lab',    name:'🧪 Drug Lab',       cost:15000, passiveBonus:200, stashBonus:0,  desc:'+$200/hr passive dirty money.' },
  { id:'mining_rig',  name:'⛏️ Mining Rig',     cost:20000, passiveBonus:300, stashBonus:0,  desc:'+$300/hr passive income.' },
  { id:'panic_room',  name:'🚨 Panic Room',      cost:50000, passiveBonus:0,   stashBonus:0,  desc:'One-time jail escape.' },
  { id:'grow_house',  name:'🌿 Grow House',      cost:12000, passiveBonus:150, stashBonus:0,  desc:'+$150/hr dirty money.' },
  { id:'vault',       name:'🏦 Vault',           cost:75000, passiveBonus:0,   stashBonus:20, desc:'Adds 20 stash slots.' },
];

async function preloadHomeCache() {
  try {
    const c    = await col('homes');
    const docs = await c.find({}).toArray();
    _homes = {};
    for (const d of docs) {
      const id = d._id; const o = { ...d }; delete o._id; _homes[id] = o;
    }
    console.log(`🏠 Home cache loaded (${Object.keys(_homes).length} homes)`);
  } catch(e) { console.error('preloadHomeCache error:', e.message); }
}

function getHome(userId)      { return _homes[userId] || null; }
function getAllHomes()         { return { ..._homes }; }

async function saveHome(userId, data) {
  _homes[userId] = data;
  try {
    const c = await col('homes');
    await c.replaceOne({ _id: userId }, { _id: userId, ...data }, { upsert: true });
  } catch(e) { console.error('saveHome error:', e.message); }
}

async function deleteHome(userId) {
  delete _homes[userId];
  try {
    const c = await col('homes');
    await c.deleteOne({ _id: userId });
  } catch(e) { console.error('deleteHome error:', e.message); }
}

function calcPassiveIncome(home) {
  const tier = HOME_TIERS[home.tier];
  if (!tier) return 0;
  const furnBonus = (home.furnishings||[]).reduce((s, f) => {
    const fd = FURNITURE_SHOP.find(x => x.id === f.id);
    return s + (fd?.passiveBonus || 0);
  }, 0);
  return tier.passivePerHr + furnBonus;
}

function getStashLimit(home) {
  const tier = HOME_TIERS[home.tier];
  if (!tier) return 0;
  const furnBonus = (home.furnishings||[]).reduce((s, f) => {
    const fd = FURNITURE_SHOP.find(x => x.id === f.id);
    return s + (fd?.stashBonus || 0);
  }, 0);
  return tier.stashSlots + furnBonus;
}

// ── SLEEP SYSTEM ──────────────────────────────────────────────
const SLEEP_DURATION_MS  = 8  * 60 * 60 * 1000; // 8 hours
const SLEEP_COOLDOWN_MS  = 12 * 60 * 60 * 1000; // 12hr cooldown

function isSleeping(home) {
  if (!home?.sleepingUntil) return false;
  if (Date.now() > home.sleepingUntil) return false;
  return true;
}

function sleepTimeLeft(home) {
  if (!isSleeping(home)) return 0;
  return home.sleepingUntil - Date.now();
}

function wakeUp(home) {
  home.sleepingUntil = null;
  return home;
}

function canSleep(home) {
  if (!home?.lastSleepAt) return true;
  return Date.now() - home.lastSleepAt >= SLEEP_COOLDOWN_MS;
}

function sleepCooldownLeft(home) {
  if (canSleep(home)) return 0;
  return (home.lastSleepAt + SLEEP_COOLDOWN_MS) - Date.now();
}

function hasPanicRoom(home) {
  return (home.furnishings||[]).some(f => f.id === 'panic_room' && !f.used);
}

function usePanicRoom(home) {
  const idx = (home.furnishings||[]).findIndex(f => f.id === 'panic_room' && !f.used);
  if (idx === -1) return false;
  home.furnishings[idx].used = true;
  return true;
}

function hasSecurityCamera(home) {
  return (home.furnishings||[]).some(f => f.id === 'security_cam');
}

module.exports = {
  preloadHomeCache, getHome, getAllHomes, saveHome, deleteHome,
  HOME_TIERS, UPGRADE_PATH, FURNITURE_SHOP,
  calcPassiveIncome, getStashLimit, hasPanicRoom, usePanicRoom, hasSecurityCamera,
  isSleeping, sleepTimeLeft, wakeUp, canSleep, sleepCooldownLeft,
  SLEEP_DURATION_MS, SLEEP_COOLDOWN_MS,
};
