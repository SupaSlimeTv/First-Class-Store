// ============================================================
// utils/db.js — Multi-Server MongoDB Edition
// Users, wallet, bank, inventory = GLOBAL (no guildId)
// Config, store = per-server for config, GLOBAL for store
//
// IMPORTANT: Every async function has a sync cache-backed
// wrapper so existing commands work without await.
// ============================================================

const { col, guildCol } = require('./mongo');

const DEFAULT_USER = {
  wallet: 500,
  bank: 0,
  lastDaily: null,
  inventory: [],
  bannedUntil: null,
  hitmanCount: 0,
  roleIncomeCooldowns: {},
  accountOpen: true,
};

const DEFAULT_CONFIG = {
  purgeActive: false,
  purgeRoleId: null,
  modRoles: {},
  prefix: '!',
  roleIncome: {},
  restrictedRoleId: null,
  robCooldownMinutes: 5,
  protectedRoles: [],
  purgeChannelId: null,
  lottery: { active: true, ticketPrice: 100, intervalHours: 24 },
};

// ── IN-MEMORY CACHE ───────────────────────────────────────────
// Keeps a hot copy of users and config so sync callers work.
// Writes go to both cache and Mongo immediately.

const _userCache   = new Map(); // userId  → user object
const _configCache = new Map(); // guildId → config object
let   _storeCache  = null;

// Seed the config cache on startup using GUILD_ID
const DEFAULT_GUILD = process.env.GUILD_ID;

// ── ASYNC INIT (call once at startup) ─────────────────────────
async function init() {
  try {
    if (DEFAULT_GUILD) {
      const c   = await guildCol('config', DEFAULT_GUILD);
      const doc = await c.findOne({ _id: 'config' });
      _configCache.set(DEFAULT_GUILD, { ...DEFAULT_CONFIG, ...(doc || {}), guildId: DEFAULT_GUILD });
    }
    const sc   = await col('store');
    const sdoc = await sc.findOne({ _id: 'store' });
    _storeCache = sdoc || { _id: 'store', items: [] };
    console.log('✅ db cache seeded');
  } catch(e) {
    console.error('db init error (non-fatal):', e.message);
  }
}

// ── USERS (GLOBAL) ────────────────────────────────────────────

// SYNC — returns cached user or a default (used by prefix commands and tick engines)
function getUser(userId) {
  return _userCache.get(userId) || null;
}

// SYNC — returns cached user or creates a default in cache (does NOT await Mongo write)
function getOrCreateUser(userId) {
  if (_userCache.has(userId)) return _userCache.get(userId);
  const newUser = { _id: userId, ...DEFAULT_USER };
  _userCache.set(userId, newUser);
  // Fire-and-forget persist
  col('users').then(c => c.updateOne({ _id: userId }, { $setOnInsert: newUser }, { upsert: true })).catch(() => {});
  return newUser;
}

// SYNC — saves to cache and fires async persist
function saveUser(userId, data) {
  _userCache.set(userId, { ...data, _id: userId });
  col('users').then(c => {
    const { _id, ...rest } = data;
    return c.updateOne({ _id: userId }, { $set: rest }, { upsert: true });
  }).catch(() => {});
}

// SYNC — returns all cached users (may not have ALL users if cache hasn't loaded them)
function getAllUsers() {
  return Object.fromEntries(_userCache.entries());
}

// ASYNC — loads a user from Mongo into cache, then returns it
async function loadUser(userId) {
  const c    = await col('users');
  const doc  = await c.findOne({ _id: userId });
  const user = doc || { _id: userId, ...DEFAULT_USER };
  _userCache.set(userId, user);
  return user;
}

// ASYNC — loads ALL users from Mongo into cache
async function loadAllUsers() {
  const c    = await col('users');
  const docs = await c.find({}).toArray();
  for (const d of docs) _userCache.set(d._id, d);
  return Object.fromEntries(_userCache.entries());
}

// SYNC — open account
function openAccount(userId) {
  if (_userCache.has(userId)) return false;
  const newUser = { _id: userId, ...DEFAULT_USER, accountOpen: true };
  _userCache.set(userId, newUser);
  col('users').then(c => c.insertOne(newUser)).catch(() => {});
  return true;
}

// SYNC — check if account exists in cache
function hasAccount(userId) {
  return _userCache.has(userId);
}

// ── CONFIG (PER-SERVER) ───────────────────────────────────────

// SYNC — returns cached config (falls back to DEFAULT_CONFIG)
function getConfig(guildId) {
  const id = guildId || DEFAULT_GUILD;
  if (_configCache.has(id)) return _configCache.get(id);
  // Not in cache yet — return default and trigger async load
  const def = { ...DEFAULT_CONFIG, guildId: id };
  _configCache.set(id, def);
  if (id) {
    guildCol('config', id).then(c => c.findOne({ _id: 'config' })).then(doc => {
      if (doc) _configCache.set(id, { ...DEFAULT_CONFIG, ...doc, guildId: id });
    }).catch(() => {});
  }
  return def;
}

// SYNC — saves config to cache and fires async persist
function saveConfig(guildId, data) {
  const id = guildId || DEFAULT_GUILD;
  _configCache.set(id, { ...data, guildId: id });
  guildCol('config', id).then(c => {
    const { _id, guildId: _gid, ...rest } = data;
    return c.updateOne({ _id: 'config' }, { $set: rest }, { upsert: true });
  }).catch(() => {});
}

// ASYNC versions (for slash commands that can await)
async function getConfigAsync(guildId) {
  const id  = guildId || DEFAULT_GUILD;
  const c   = await guildCol('config', id);
  const doc = await c.findOne({ _id: 'config' });
  const cfg = { ...DEFAULT_CONFIG, ...(doc || {}), guildId: id };
  _configCache.set(id, cfg);
  return cfg;
}

async function saveConfigAsync(guildId, data) {
  const id = guildId || DEFAULT_GUILD;
  _configCache.set(id, { ...data, guildId: id });
  const c = await guildCol('config', id);
  const { _id, guildId: _gid, ...rest } = data;
  await c.updateOne({ _id: 'config' }, { $set: rest }, { upsert: true });
}

// ── STORE (GLOBAL) ────────────────────────────────────────────

// SYNC — returns cached store
function getStore() {
  if (_storeCache) return _storeCache;
  const def = { _id: 'store', items: [] };
  _storeCache = def;
  col('store').then(c => c.findOne({ _id: 'store' })).then(doc => {
    if (doc) _storeCache = doc;
  }).catch(() => {});
  return def;
}

// SYNC — saves store to cache and fires async persist
function saveStore(data) {
  _storeCache = data;
  col('store').then(c => {
    const { _id, ...rest } = data;
    return c.updateOne({ _id: 'store' }, { $set: rest }, { upsert: true });
  }).catch(() => {});
}

// ── ECONOMY HELPERS ───────────────────────────────────────────

function addToWallet(userId, amount) {
  const user = getOrCreateUser(userId);
  user.wallet += amount;
  saveUser(userId, user);
  return user;
}

function deposit(userId, amount) {
  const user = getOrCreateUser(userId);
  if (amount > user.wallet) throw new Error('Not enough money in wallet.');
  user.wallet -= amount;
  user.bank   += amount;
  saveUser(userId, user);
  return user;
}

function withdraw(userId, amount) {
  const user = getOrCreateUser(userId);
  if (amount > user.bank) throw new Error('Not enough money in bank.');
  user.bank   -= amount;
  user.wallet += amount;
  saveUser(userId, user);
  return user;
}

function isPurgeActive(guildId) {
  return getConfig(guildId).purgeActive;
}

// ── INVENTORY (GLOBAL) ────────────────────────────────────────

function giveItem(userId, itemId) {
  const user = getOrCreateUser(userId);
  if (!user.inventory) user.inventory = [];
  user.inventory.push(itemId);
  saveUser(userId, user);
  col('users').then(c => c.updateOne({ _id: userId }, { $push: { inventory: itemId } }, { upsert: true })).catch(() => {});
}

function removeItem(userId, itemId) {
  const user = getUser(userId);
  if (!user?.inventory) return false;
  const idx = user.inventory.indexOf(itemId);
  if (idx === -1) return false;
  user.inventory.splice(idx, 1);
  saveUser(userId, user);
  return true;
}

function isBotBanned(userId) {
  const user = getUser(userId);
  if (!user?.bannedUntil) return false;
  if (Date.now() > user.bannedUntil) {
    saveUser(userId, { ...user, bannedUntil: null });
    return false;
  }
  return true;
}

// ── STARTUP: pre-load all users + config into cache ──────────
// Called from index.js after client is ready
async function preloadCache() {
  try {
    await loadAllUsers();
    if (DEFAULT_GUILD) await getConfigAsync(DEFAULT_GUILD);
    const sc   = await col('store');
    const sdoc = await sc.findOne({ _id: 'store' });
    if (sdoc) _storeCache = sdoc;
    console.log(`✅ Cache loaded: ${_userCache.size} users`);
  } catch(e) {
    console.error('preloadCache error:', e.message);
  }
}

module.exports = {
  // Sync (used by existing commands + tick engines)
  getUser, getOrCreateUser, openAccount, hasAccount, saveUser,
  getAllUsers, getConfig, saveConfig, getStore, saveStore,
  addToWallet, deposit, withdraw, isPurgeActive,
  giveItem, removeItem, isBotBanned,
  // Async (for slash commands that can await)
  loadUser, loadAllUsers, getConfigAsync, saveConfigAsync,
  // Startup
  preloadCache, init,
};
