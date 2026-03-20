// ============================================================
// utils/db.js — JSON "Database" Manager
// All economy data is stored in data/users.json
// All server config (purge state, mod roles) in data/config.json
// Item store data in data/store.json
//
// TEACHES: fs module, JSON.parse/stringify, error handling,
//          default values, object destructuring
// ============================================================

const fs = require('fs');
const path = require('path');

const USERS_FILE  = path.join(__dirname, '../data/users.json');
const CONFIG_FILE = path.join(__dirname, '../data/config.json');
const STORE_FILE  = path.join(__dirname, '../data/store.json');

// ---- HELPERS: Read & Write JSON files ----

function readJSON(filePath, defaultValue = {}) {
  try {
    // If file doesn't exist yet, return the default
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

function writeJSON(filePath, data) {
  // null, 2 = pretty-print with 2-space indentation (readable JSON)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ---- USER DATA ----

const DEFAULT_USER = {
  wallet: 500,
  bank: 0,
  lastDaily: null,
  inventory: [],
  bannedUntil: null,
  hitmanCount: 0,
  roleIncomeCooldowns: {},
  accountOpen: true, // false = user hasn't opened an account yet
};

/**
 * Get a user's data — returns null if they haven't opened an account yet.
 * @param {string} userId - Discord user ID
 */
function getUser(userId) {
  const users = readJSON(USERS_FILE);
  if (!users[userId]) return null;
  // Backfill accountOpen for existing users
  if (users[userId].accountOpen === undefined) {
    users[userId].accountOpen = true;
    writeJSON(USERS_FILE, users);
  }
  return users[userId];
}

/**
 * Get or create a user — used internally where we always need a user object.
 * Only call this after confirming the user has an account.
 */
function getOrCreateUser(userId) {
  const users = readJSON(USERS_FILE);
  if (!users[userId]) {
    users[userId] = { ...DEFAULT_USER };
    writeJSON(USERS_FILE, users);
  }
  if (users[userId].accountOpen === undefined) {
    users[userId].accountOpen = true;
    writeJSON(USERS_FILE, users);
  }
  return users[userId];
}

/**
 * Open a new account for a user — called when they type "open account"
 */
function openAccount(userId) {
  const users = readJSON(USERS_FILE);
  if (users[userId]) return false; // already exists
  users[userId] = { ...DEFAULT_USER, accountOpen: true };
  writeJSON(USERS_FILE, users);
  return true;
}

/**
 * Check if a user has an account
 */
function hasAccount(userId) {
  const users = readJSON(USERS_FILE);
  return !!users[userId];
}

/**
 * Save updated data for a single user
 */
function saveUser(userId, data) {
  const users = readJSON(USERS_FILE);
  users[userId] = data;
  writeJSON(USERS_FILE, users);
}

/**
 * Get ALL users (used for purge — need to loop everyone)
 */
function getAllUsers() {
  return readJSON(USERS_FILE);
}

/**
 * Save ALL users at once (used for bulk purge operation)
 */
function saveAllUsers(data) {
  writeJSON(USERS_FILE, data);
}

// ---- SERVER CONFIG ----

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
  lottery: {
    active:        true,
    ticketPrice:   100,
    intervalHours: 24,
  },
};

function getConfigFile(guildId) {
  const id = guildId || process.env.GUILD_ID || 'default';
  return path.join(__dirname, `../data/config_${id}.json`);
}

function getConfig(guildId) {
  // Try guild-specific file first
  const guildFile = getConfigFile(guildId);
  if (fs.existsSync(guildFile)) {
    const config = readJSON(guildFile);
    return { ...DEFAULT_CONFIG, ...config };
  }
  // Fall back to legacy config.json (migrates old data automatically)
  const legacy = readJSON(CONFIG_FILE);
  if (Object.keys(legacy).length && guildId) {
    // Migrate legacy config to guild-specific file on first read
    writeJSON(guildFile, legacy);
  }
  return { ...DEFAULT_CONFIG, ...legacy };
}

function saveConfig(guildId, data) {
  // Support both saveConfig(guildId, data) and old saveConfig(data)
  if (typeof guildId === 'object') { data = guildId; guildId = null; }
  writeJSON(getConfigFile(guildId), data);
  // Also keep legacy file in sync for backwards compat
  if (!guildId || guildId === process.env.GUILD_ID) writeJSON(CONFIG_FILE, data);
}

// ---- ECONOMY HELPERS ----

/**
 * Add money to a user's wallet
 */
function addToWallet(userId, amount) {
  const user = getUser(userId);
  user.wallet += amount;
  saveUser(userId, user);
  return user;
}

/**
 * Transfer money from wallet to bank
 */
function deposit(userId, amount) {
  const user = getUser(userId);
  if (amount > user.wallet) throw new Error('Not enough money in wallet.');
  user.wallet -= amount;
  user.bank += amount;
  saveUser(userId, user);
  return user;
}

/**
 * Transfer money from bank to wallet
 */
function withdraw(userId, amount) {
  const user = getUser(userId);
  if (amount > user.bank) throw new Error('Not enough money in bank.');
  user.bank -= amount;
  user.wallet += amount;
  saveUser(userId, user);
  return user;
}

/**
 * Check if purge is currently active
 */
function isPurgeActive(guildId) {
  return !!getConfig(guildId).purgeActive;
}

// ---- ITEM STORE ----

const DEFAULT_STORE = {
  items: [
    {
      id: 'hitman',
      name: '🔫 Hitman',
      description: 'Deploy against a user — rob 50% of their balance OR silence them for 24h. Fails = you lose 50% as karma.',
      price: 2500,
      type: 'useable',
      reusable: false,
      roleReward: null,
      effect: {
        type: 'hitman',
        action: 'rob', // 'rob' or 'silence' — set per item
      },
      requirements: null,
      enabled: true,
    },
  ],
};

function getStore() {
  const store = readJSON(STORE_FILE);
  if (!store.items) return DEFAULT_STORE;
  return store;
}

function saveStore(data) {
  writeJSON(STORE_FILE, data);
}

// ---- INVENTORY HELPERS ----

/**
 * Add an item to a user's inventory
 */
function giveItem(userId, itemId) {
  const user = getUser(userId);
  if (!user.inventory) user.inventory = [];
  user.inventory.push(itemId);
  saveUser(userId, user);
  return user;
}

/**
 * Remove one instance of an item from inventory (returns false if not found)
 */
function removeItem(userId, itemId) {
  const user = getUser(userId);
  if (!user.inventory) return false;
  const idx = user.inventory.indexOf(itemId);
  if (idx === -1) return false;
  user.inventory.splice(idx, 1); // splice(index, deleteCount) — removes 1 item at idx
  saveUser(userId, user);
  return true;
}

/**
 * Check if a user is currently bot-banned by hitman
 */
function isBotBanned(userId) {
  const user = getUser(userId);
  if (!user.bannedUntil) return false;
  if (Date.now() > user.bannedUntil) {
    // Ban expired — clear it
    user.bannedUntil = null;
    saveUser(userId, user);
    return false;
  }
  return true;
}

module.exports = {
  getUser,
  getOrCreateUser,
  openAccount,
  hasAccount,
  saveUser,
  getAllUsers,
  saveAllUsers,
  getConfig,
  saveConfig,
  addToWallet,
  deposit,
  withdraw,
  isPurgeActive,
  getStore,
  saveStore,
  giveItem,
  removeItem,
  isBotBanned,
};
