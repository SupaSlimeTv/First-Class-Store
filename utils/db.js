// ============================================================
// utils/db.js — Multi-Server MongoDB Edition
// Users, wallet, bank, inventory = GLOBAL (no guildId)
// Config, store = per-server for config, GLOBAL for store
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

// ── USERS (GLOBAL) ────────────────────────────────────────────

async function getUser(userId) {
  const c = await col('users');
  return await c.findOne({ _id: userId }) || null;
}

async function getOrCreateUser(userId) {
  const c = await col('users');
  const existing = await c.findOne({ _id: userId });
  if (existing) return existing;
  const newUser = { _id: userId, ...DEFAULT_USER };
  await c.insertOne(newUser);
  return newUser;
}

async function openAccount(userId) {
  const c = await col('users');
  if (await c.findOne({ _id: userId })) return false;
  await c.insertOne({ _id: userId, ...DEFAULT_USER, accountOpen: true });
  return true;
}

async function hasAccount(userId) {
  const c = await col('users');
  return !!(await c.findOne({ _id: userId }));
}

async function saveUser(userId, data) {
  const c = await col('users');
  const { _id, ...rest } = data;
  await c.updateOne({ _id: userId }, { $set: rest }, { upsert: true });
}

async function getAllUsers() {
  const c    = await col('users');
  const docs = await c.find({}).toArray();
  return Object.fromEntries(docs.map(d => [d._id, d]));
}

async function saveAllUsers(dataObj) {
  const c  = await col('users');
  const ops = Object.entries(dataObj).map(([id, data]) => {
    const { _id, ...rest } = data;
    return { updateOne: { filter: { _id: id }, update: { $set: rest }, upsert: true } };
  });
  if (ops.length) await c.bulkWrite(ops);
}

// ── CONFIG (PER-SERVER) ───────────────────────────────────────

async function getConfig(guildId) {
  const c   = await guildCol('config', guildId);
  const doc = await c.findOne({ _id: 'config' });
  return { ...DEFAULT_CONFIG, ...(doc || {}), guildId };
}

async function saveConfig(guildId, data) {
  const c = await guildCol('config', guildId);
  const { _id, ...rest } = data;
  await c.updateOne({ _id: 'config' }, { $set: rest }, { upsert: true });
}

// ── STORE (GLOBAL) ────────────────────────────────────────────

async function getStore() {
  const c   = await col('store');
  const doc = await c.findOne({ _id: 'store' });
  return doc || { _id: 'store', items: [] };
}

async function saveStore(data) {
  const c = await col('store');
  const { _id, ...rest } = data;
  await c.updateOne({ _id: 'store' }, { $set: rest }, { upsert: true });
}

// ── ECONOMY HELPERS ───────────────────────────────────────────

async function addToWallet(userId, amount) {
  const user = await getOrCreateUser(userId);
  user.wallet += amount;
  await saveUser(userId, user);
  return user;
}

async function deposit(userId, amount) {
  const user = await getOrCreateUser(userId);
  if (amount > user.wallet) throw new Error('Not enough money in wallet.');
  user.wallet -= amount;
  user.bank   += amount;
  await saveUser(userId, user);
  return user;
}

async function withdraw(userId, amount) {
  const user = await getOrCreateUser(userId);
  if (amount > user.bank) throw new Error('Not enough money in bank.');
  user.bank   -= amount;
  user.wallet += amount;
  await saveUser(userId, user);
  return user;
}

async function isPurgeActive(guildId) {
  const config = await getConfig(guildId);
  return config.purgeActive;
}

// ── INVENTORY (GLOBAL) ────────────────────────────────────────

async function giveItem(userId, itemId) {
  const c = await col('users');
  await c.updateOne({ _id: userId }, { $push: { inventory: itemId } }, { upsert: true });
}

async function removeItem(userId, itemId) {
  const user = await getUser(userId);
  if (!user?.inventory) return false;
  const idx = user.inventory.indexOf(itemId);
  if (idx === -1) return false;
  user.inventory.splice(idx, 1);
  await saveUser(userId, user);
  return true;
}

async function isBotBanned(userId) {
  const user = await getUser(userId);
  if (!user?.bannedUntil) return false;
  if (Date.now() > user.bannedUntil) {
    await saveUser(userId, { ...user, bannedUntil: null });
    return false;
  }
  return true;
}

module.exports = {
  getUser, getOrCreateUser, openAccount, hasAccount, saveUser,
  getAllUsers, saveAllUsers, getConfig, saveConfig, getStore, saveStore,
  addToWallet, deposit, withdraw, isPurgeActive,
  giveItem, removeItem, isBotBanned,
};
