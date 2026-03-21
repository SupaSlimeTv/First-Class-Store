// ============================================================
// utils/db.js — MongoDB-backed Database
// All data persists across Railway deploys via MongoDB Atlas
// ============================================================

const { col } = require('./mongo');

// ── IN-MEMORY CACHES ─────────────────────────────────────
let _users  = {};   // userId -> user object
let _config = {};   // guildId -> config object
let _store  = null; // { items: [...] }

// ── DEFAULT VALUES ────────────────────────────────────────
const DEFAULT_USER = {
  wallet: 500, bank: 0, lastDaily: null, inventory: [],
  bannedUntil: null, hitmanCount: 0, roleIncomeCooldowns: {},
  accountOpen: true,
};

const DEFAULT_CONFIG = {
  purgeActive: false, purgeRoleId: null, modRoles: {}, prefix: '!',
  roleIncome: {}, restrictedRoleId: null, robCooldownMinutes: 5,
  protectedRoles: [], purgeChannelId: null, shotTimeoutMinutes: 5,
  prisonRoleId: null, prisonChannelId: null, prisonCategoryId: null, solitaryRoleId: null,
  lottery: { active: true, ticketPrice: 100, intervalHours: 24 },
};

const DEFAULT_STORE = {
  items: [{
    id: 'hitman', name: '🔫 Hitman',
    description: 'Deploy against a user — rob 50% of their balance OR silence them for 24h.',
    price: 2500, type: 'useable', reusable: false, roleReward: null,
    effect: { type: 'hitman', action: 'rob' }, requirements: null, enabled: true,
  }],
};

// ── PRELOAD ───────────────────────────────────────────────
async function preloadCache() {
  try {
    const [uc, cc, sc] = await Promise.all([col('users'), col('configs'), col('store')]);
    const [users, configs, storeDoc] = await Promise.all([
      uc.find({}).toArray(),
      cc.find({}).toArray(),
      sc.findOne({ _id: 'store' }),
    ]);
    _users  = Object.fromEntries(users.map(d   => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    _config = Object.fromEntries(configs.map(d => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    _store  = storeDoc ? { items: storeDoc.items || [] } : null;
    console.log(`📂 Cache preloaded (${Object.keys(_users).length} users)`);
  } catch(e) { console.error('preloadCache error:', e.message); }
}

// ── USERS ─────────────────────────────────────────────────
function getUser(userId) {
  return _users[userId] || null;
}

function getOrCreateUser(userId) {
  if (!_users[userId]) _users[userId] = { ...DEFAULT_USER };
  return _users[userId];
}

function hasAccount(userId) { return !!_users[userId]; }

function openAccount(userId) {
  if (_users[userId]) return false;
  _users[userId] = { ...DEFAULT_USER, accountOpen: true };
  saveUser(userId, _users[userId]);
  return true;
}

function saveUser(userId, data) {
  _users[userId] = data;
  // Fire-and-forget async save — don't block sync callers
  col('users').then(c => c.replaceOne({ _id: userId }, { _id: userId, ...data }, { upsert: true }))
    .catch(e => console.error('saveUser error:', e.message));
}

function getAllUsers()     { return { ..._users }; }
function saveAllUsers(data) {
  _users = { ...data };
  col('users').then(async c => {
    const ops = Object.entries(data).map(([id, u]) => ({
      replaceOne: { filter: { _id: id }, replacement: { _id: id, ...u }, upsert: true }
    }));
    if (ops.length) await c.bulkWrite(ops);
  }).catch(e => console.error('saveAllUsers error:', e.message));
}

// ── CONFIG ────────────────────────────────────────────────
function getConfig(guildId) {
  const id = guildId || process.env.GUILD_ID || 'default';
  return { ...DEFAULT_CONFIG, ...(_config[id] || {}) };
}

function saveConfig(guildId, data) {
  if (typeof guildId === 'object') { data = guildId; guildId = null; }
  const id = guildId || process.env.GUILD_ID || 'default';
  _config[id] = data;
  col('configs').then(c => c.replaceOne({ _id: id }, { _id: id, ...data }, { upsert: true }))
    .catch(e => console.error('saveConfig error:', e.message));
}

// ── STORE ─────────────────────────────────────────────────
function getStore() {
  return _store || DEFAULT_STORE;
}

function saveStore(data) {
  _store = data;
  col('store').then(c => c.replaceOne({ _id: 'store' }, { _id: 'store', ...data }, { upsert: true }))
    .catch(e => console.error('saveStore error:', e.message));
}

// ── ECONOMY HELPERS ───────────────────────────────────────
function addToWallet(userId, amount) {
  const user = getOrCreateUser(userId); user.wallet += amount; saveUser(userId, user); return user;
}

function deposit(userId, amount) {
  const user = getUser(userId);
  if (amount > user.wallet) throw new Error('Not enough money in wallet.');
  user.wallet -= amount; user.bank += amount; saveUser(userId, user); return user;
}

function withdraw(userId, amount) {
  const user = getUser(userId);
  if (amount > user.bank) throw new Error('Not enough money in bank.');
  user.bank -= amount; user.wallet += amount; saveUser(userId, user); return user;
}

function isPurgeActive(guildId) { return !!getConfig(guildId).purgeActive; }

// ── INVENTORY ─────────────────────────────────────────────
function giveItem(userId, itemId) {
  const user = getOrCreateUser(userId);
  if (!user.inventory) user.inventory = [];
  user.inventory.push(itemId); saveUser(userId, user); return user;
}

function removeItem(userId, itemId) {
  const user = getUser(userId); if (!user?.inventory) return false;
  const idx = user.inventory.indexOf(itemId); if (idx === -1) return false;
  user.inventory.splice(idx, 1); saveUser(userId, user); return true;
}

function isBotBanned(userId) {
  const user = getUser(userId); if (!user?.bannedUntil) return false;
  if (Date.now() > user.bannedUntil) { user.bannedUntil = null; saveUser(userId, user); return false; }
  return true;
}

module.exports = {
  preloadCache,
  getUser, getOrCreateUser, openAccount, hasAccount, saveUser, getAllUsers, saveAllUsers,
  getConfig, saveConfig,
  getStore, saveStore,
  addToWallet, deposit, withdraw, isPurgeActive,
  giveItem, removeItem, isBotBanned,
};
