// ============================================================
// utils/db.js — MongoDB-backed Database
// Users/economy: GLOBAL (shared across servers — intentional)
// Config: per-guild
// Store: per-guild
// ============================================================

const { col } = require('./mongo');

let _users  = {};   // userId -> user object (global)
let _config = {};   // guildId -> config object
let _stores = {};   // guildId -> { items: [...] }

let _activeGuild = process.env.GUILD_ID || 'default';
function setGuildContext(guildId) { if (guildId) _activeGuild = guildId; }
function getGuildContext()        { return _activeGuild; }

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

// ── PRELOAD ───────────────────────────────────────────────────
async function preloadCache() {
  try {
    const [uc, cc, sc] = await Promise.all([col('users'), col('configs'), col('store')]);
    const [users, configs, storeDocs] = await Promise.all([
      uc.find({}).toArray(),
      cc.find({}).toArray(),
      sc.find({}).toArray(),
    ]);
    _users  = Object.fromEntries(users.map(d => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    _config = Object.fromEntries(configs.map(d => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    _stores = {};
    for (const d of storeDocs) {
      if (d._id === 'store') {
        // Old global store — keep under GUILD_ID for migration
        const gid = process.env.GUILD_ID || 'default';
        if (!_stores[gid]) _stores[gid] = { items: d.items || [] };
      } else if (d._id.includes(':store')) {
        const gid = d._id.replace(':store', '');
        _stores[gid] = { items: d.items || [] };
      }
    }
    console.log(`📂 Cache preloaded (${Object.keys(_users).length} users, ${Object.keys(_stores).length} stores)`);
  } catch(e) { console.error('preloadCache error:', e.message); }
}

// ── USERS (GLOBAL — shared across all servers) ─────────────────
function getUser(userId)           { return _users[userId] || null; }
function getOrCreateUser(userId)   { if (!_users[userId]) _users[userId] = { ...DEFAULT_USER }; return _users[userId]; }
function hasAccount(userId)        { return !!_users[userId]; }
function getAllUsers()              { return { ..._users }; }

function openAccount(userId) {
  if (_users[userId]) return false;
  _users[userId] = { ...DEFAULT_USER, accountOpen: true };
  saveUser(userId, _users[userId]);
  return true;
}

function saveUser(userId, data) {
  _users[userId] = data;
  col('users').then(c => c.replaceOne({ _id: userId }, { _id: userId, ...data }, { upsert: true }))
    .catch(e => console.error('saveUser error:', e.message));
}

function saveAllUsers(data) {
  _users = { ...data };
  col('users').then(async c => {
    const ops = Object.entries(data).map(([id, u]) => ({
      replaceOne: { filter: { _id: id }, replacement: { _id: id, ...u }, upsert: true }
    }));
    if (ops.length) await c.bulkWrite(ops);
  }).catch(e => console.error('saveAllUsers error:', e.message));
}

// ── CONFIG (PER-GUILD) ────────────────────────────────────────
function getConfig(guildId) {
  const id = guildId || _activeGuild || 'default';
  return { ...DEFAULT_CONFIG, ...(_config[id] || {}) };
}

function saveConfig(guildId, data) {
  if (typeof guildId === 'object') { data = guildId; guildId = null; }
  const id = guildId || _activeGuild || 'default';
  _config[id] = data;
  col('configs').then(c => c.replaceOne({ _id: id }, { _id: id, ...data }, { upsert: true }))
    .catch(e => console.error('saveConfig error:', e.message));
}

// ── STORE (PER-GUILD) ─────────────────────────────────────────
function getStore(guildId) {
  const gid = guildId || _activeGuild;
  return _stores[gid] || { ...DEFAULT_STORE };
}

function saveStore(data, guildId) {
  const gid = guildId || _activeGuild;
  _stores[gid] = data;
  const key = `${gid}:store`;
  col('store').then(c => c.replaceOne({ _id: key }, { _id: key, ...data }, { upsert: true }))
    .catch(e => console.error('saveStore error:', e.message));
}

// ── ECONOMY HELPERS ───────────────────────────────────────────
function addToWallet(userId, amount) { const u=getOrCreateUser(userId); u.wallet+=amount; saveUser(userId,u); return u; }
function deposit(userId, amount)     { const u=getUser(userId); if(amount>u.wallet) throw new Error('Not enough in wallet.'); u.wallet-=amount; u.bank+=amount; saveUser(userId,u); return u; }
function withdraw(userId, amount)    { const u=getUser(userId); if(amount>u.bank) throw new Error('Not enough in bank.'); u.bank-=amount; u.wallet+=amount; saveUser(userId,u); return u; }
function isPurgeActive(guildId)      { return !!getConfig(guildId).purgeActive; }

// ── INVENTORY ─────────────────────────────────────────────────
function giveItem(userId, itemId) {
  const u=getOrCreateUser(userId); if(!u.inventory) u.inventory=[];
  u.inventory.push(itemId); saveUser(userId,u); return u;
}
function removeItem(userId, itemId) {
  const u=getUser(userId); if(!u?.inventory) return false;
  const idx=u.inventory.indexOf(itemId); if(idx===-1) return false;
  u.inventory.splice(idx,1); saveUser(userId,u); return true;
}
function isBotBanned(userId) {
  const u=getUser(userId); if(!u?.bannedUntil) return false;
  if(Date.now()>u.bannedUntil){u.bannedUntil=null;saveUser(userId,u);return false;}
  return true;
}

module.exports = {
  preloadCache, setGuildContext, getGuildContext,
  getUser, getOrCreateUser, openAccount, hasAccount, saveUser, getAllUsers, saveAllUsers,
  getConfig, saveConfig,
  getStore, saveStore,
  addToWallet, deposit, withdraw, isPurgeActive,
  giveItem, removeItem, isBotBanned,
};
