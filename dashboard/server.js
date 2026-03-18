// ============================================================
// dashboard/server.js — Owner Dashboard Backend
// Run with: npm run dashboard  (separate from the bot)
// Opens at: http://localhost:3001
//
// API Routes:
//   GET  /api/stats            — overview numbers
//   GET  /api/users            — all user balances
//   POST /api/users/:id/money  — edit wallet/bank
//   GET  /api/store            — all store items
//   POST /api/store            — add item
//   PUT  /api/store/:id        — edit item
//   DELETE /api/store/:id      — delete item
//   GET  /api/config           — purge state + mod roles
//   POST /api/purge/start      — start purge
//   POST /api/purge/end        — end purge
// ============================================================

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../utils/db');

const app  = express();
const PORT = process.env.DASHBOARD_PORT || 3001;

// In-memory username cache so we don't spam Discord API
// { userId: { username, avatar, cachedAt } }
const usernameCache = {};

async function fetchDiscordUser(userId) {
  const now = Date.now();
  const cached = usernameCache[userId];
  // Cache for 10 minutes
  if (cached && now - cached.cachedAt < 600_000) return cached;

  try {
    const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${process.env.TOKEN}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = {
      username:  data.global_name || data.username || userId,
      avatar:    data.avatar
        ? `https://cdn.discordapp.com/avatars/${userId}/${data.avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(userId) % 5}.png`,
      cachedAt: now,
    };
    usernameCache[userId] = entry;
    return entry;
  } catch {
    return null;
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// STATS
// ============================================================
app.get('/api/stats', (req, res) => {
  const users  = db.getAllUsers();
  const store  = db.getStore();
  const config = db.getConfig();
  const warnings = (() => {
    try {
      const f = path.join(__dirname, '../data/warnings.json');
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    } catch { return {}; }
  })();

  const userList = Object.values(users);
  const totalMoney = userList.reduce((s, u) => s + u.wallet + u.bank, 0);
  const totalWarnings = Object.values(warnings).reduce((s, w) => s + w.length, 0);

  res.json({
    totalUsers:    userList.length,
    totalMoney,
    storeItems:    store.items.length,
    purgeActive:   config.purgeActive,
    totalWarnings,
    modRoles:      Object.keys(config.modRoles).length,
  });
});

// ============================================================
// USERS
// ============================================================
app.get('/api/users', async (req, res) => {
  const users = db.getAllUsers();

  // Fetch all display names in parallel
  const list = await Promise.all(
    Object.entries(users).map(async ([id, data]) => {
      const discordUser = await fetchDiscordUser(id);
      return {
        id,
        username: discordUser?.username || id,
        avatar:   discordUser?.avatar   || null,
        wallet:      data.wallet || 0,
        bank:        data.bank   || 0,
        total:       (data.wallet || 0) + (data.bank || 0),
        inventory:   data.inventory || [],
        bannedUntil: data.bannedUntil || null,
        lastDaily:   data.lastDaily  || null,
      };
    })
  );

  list.sort((a, b) => b.total - a.total);
  res.json(list);
});

// Edit a user's wallet and/or bank
app.post('/api/users/:id/money', (req, res) => {
  const { id } = req.params;
  const { wallet, bank } = req.body;

  const user = db.getUser(id);

  // Only update fields that were actually provided (not null/undefined)
  if (wallet !== undefined && wallet !== null) user.wallet = Math.max(0, parseInt(wallet) || 0);
  if (bank   !== undefined && bank   !== null) user.bank   = Math.max(0, parseInt(bank)   || 0);

  db.saveUser(id, user);
  res.json({ success: true, user });
});

// Unban a user (remove hitman silence)
app.post('/api/users/:id/unban', (req, res) => {
  const user = db.getUser(req.params.id);
  user.bannedUntil = null;
  db.saveUser(req.params.id, user);
  res.json({ success: true });
});

// ============================================================
// STORE
// ============================================================
app.get('/api/store', (req, res) => {
  res.json(db.getStore());
});

// Add a new item
app.post('/api/store', (req, res) => {
  const store = db.getStore();
  const { name, description, price, type, roleReward, reusable, effect, requirements } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'name and price are required' });
  }

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  if (store.items.find((i) => i.id === id)) {
    return res.status(400).json({ error: `Item with id "${id}" already exists. Use a different name.` });
  }

  const newItem = {
    id,
    name,
    description: description || '',
    price:       parseInt(price) || 100,
    type:        type || 'useable',
    reusable:    reusable || false,
    roleReward:  roleReward || null,
    effect:      effect || null,
    requirements: requirements || null,
    // requirements structure:
    // {
    //   type: 'item' | 'balance' | 'role',
    //   value: 'item-id' | 5000 | 'role-id',
    //   label: 'display label shown to user',
    // }
    enabled: true,
  };

  store.items.push(newItem);
  db.saveStore(store);
  res.json({ success: true, item: newItem });
});

// Edit an existing item
app.put('/api/store/:id', (req, res) => {
  const store = db.getStore();
  const idx   = store.items.findIndex((i) => i.id === req.params.id);

  if (idx === -1) return res.status(404).json({ error: 'Item not found' });

  // Merge — only overwrite fields that were sent
  store.items[idx] = { ...store.items[idx], ...req.body, id: req.params.id };
  db.saveStore(store);
  res.json({ success: true, item: store.items[idx] });
});

// Delete an item
app.delete('/api/store/:id', (req, res) => {
  const store = db.getStore();
  const before = store.items.length;
  store.items = store.items.filter((i) => i.id !== req.params.id);

  if (store.items.length === before) return res.status(404).json({ error: 'Item not found' });

  db.saveStore(store);
  res.json({ success: true });
});

// ============================================================
// ACTIVE EFFECTS (read-only view for dashboard)
// ============================================================
app.get('/api/effects', (req, res) => {
  try {
    const f = path.join(__dirname, '../data/activeEffects.json');
    const data = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    res.json(data);
  } catch { res.json({}); }
});

// Clear a user's shield from the dashboard
app.post('/api/effects/:id/clear-shield', (req, res) => {
  try {
    const f = path.join(__dirname, '../data/activeEffects.json');
    const data = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    if (data[req.params.id]) {
      data[req.params.id].shield = null;
      fs.writeFileSync(f, JSON.stringify(data, null, 2));
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// PURGE CONTROL
// ============================================================
app.post('/api/purge/start', (req, res) => {
  const config = db.getConfig();
  if (config.purgeActive) return res.status(400).json({ error: 'Purge already active' });

  // Drain all banks to wallets
  const allUsers = db.getAllUsers();
  for (const userId in allUsers) {
    allUsers[userId].wallet += allUsers[userId].bank;
    allUsers[userId].bank    = 0;
  }
  db.saveAllUsers(allUsers);

  config.purgeActive   = true;
  config.purgeStartTime = Date.now();
  db.saveConfig(config);

  res.json({ success: true });
});

app.post('/api/purge/end', (req, res) => {
  const config = db.getConfig();
  if (!config.purgeActive) return res.status(400).json({ error: 'Purge not active' });

  config.purgeActive    = false;
  config.purgeStartTime = null;
  db.saveConfig(config);

  res.json({ success: true });
});

// ============================================================
// CONFIG
// ============================================================
app.get('/api/config', (req, res) => {
  res.json(db.getConfig());
});

// Update prefix
app.post('/api/config/prefix', (req, res) => {
  const { prefix } = req.body;
  if (!prefix || typeof prefix !== 'string' || prefix.length > 5) {
    return res.status(400).json({ error: 'Prefix must be 1–5 characters.' });
  }
  const config = db.getConfig();
  config.prefix = prefix.trim();
  db.saveConfig(config);
  res.json({ success: true, prefix: config.prefix });
});

// Update restricted role
app.post('/api/config/restricted-role', (req, res) => {
  const { roleId } = req.body;
  const config = db.getConfig();
  config.restrictedRoleId = roleId || null;
  db.saveConfig(config);
  res.json({ success: true, restrictedRoleId: config.restrictedRoleId });
});

// Update purge announcement channel
app.post('/api/config/purge-channel', (req, res) => {
  const { channelId } = req.body;
  const config = db.getConfig();
  config.purgeChannelId = channelId || null;
  db.saveConfig(config);
  res.json({ success: true, purgeChannelId: config.purgeChannelId });
});

// Update rob cooldown
app.post('/api/config/rob-cooldown', (req, res) => {
  const { minutes } = req.body;
  const parsed = parseFloat(minutes);
  if (isNaN(parsed) || parsed < 0) {
    return res.status(400).json({ error: 'Minutes must be a number >= 0' });
  }
  const config = db.getConfig();
  config.robCooldownMinutes = parsed;
  db.saveConfig(config);
  res.json({ success: true, robCooldownMinutes: parsed });
});

// ============================================================
// PROTECTED ROLES
// ============================================================
app.get('/api/protected-roles', (req, res) => {
  const config = db.getConfig();
  res.json(config.protectedRoles || []);
});

app.post('/api/protected-roles', (req, res) => {
  const { roleId } = req.body;
  if (!roleId) return res.status(400).json({ error: 'roleId is required' });
  const config = db.getConfig();
  if (!config.protectedRoles) config.protectedRoles = [];
  if (config.protectedRoles.includes(roleId)) {
    return res.status(400).json({ error: 'Role is already protected' });
  }
  config.protectedRoles.push(roleId);
  db.saveConfig(config);
  res.json({ success: true, protectedRoles: config.protectedRoles });
});

app.delete('/api/protected-roles/:roleId', (req, res) => {
  const config = db.getConfig();
  config.protectedRoles = (config.protectedRoles || []).filter(r => r !== req.params.roleId);
  db.saveConfig(config);
  res.json({ success: true, protectedRoles: config.protectedRoles });
});

// ============================================================
// ROLE INCOME
// ============================================================

// Get all role income entries
app.get('/api/roleincome', (req, res) => {
  const config = db.getConfig();
  res.json(config.roleIncome || {});
});

// Add or update a role income entry
app.post('/api/roleincome', (req, res) => {
  const { roleId, name, amount, location, intervalHours } = req.body;

  if (!roleId || !name || !amount) {
    return res.status(400).json({ error: 'roleId, name, and amount are required.' });
  }
  if (!['wallet', 'bank'].includes(location)) {
    return res.status(400).json({ error: 'location must be "wallet" or "bank".' });
  }

  const config = db.getConfig();
  if (!config.roleIncome) config.roleIncome = {};

  config.roleIncome[roleId] = {
    name:          name.trim(),
    amount:        parseInt(amount) || 0,
    location:      location,
    intervalHours: parseFloat(intervalHours) || 24,
  };

  db.saveConfig(config);
  res.json({ success: true, entry: config.roleIncome[roleId] });
});

// Delete a role income entry
app.delete('/api/roleincome/:roleId', (req, res) => {
  const config = db.getConfig();
  if (!config.roleIncome || !config.roleIncome[req.params.roleId]) {
    return res.status(404).json({ error: 'Role income entry not found.' });
  }
  delete config.roleIncome[req.params.roleId];
  db.saveConfig(config);
  res.json({ success: true });
});

// ============================================================
// CATCH-ALL — Serve the SPA for any unmatched route
// ============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🖥️  Owner Dashboard running at http://localhost:${PORT}`);
  console.log(`   Press Ctrl+C to stop\n`);
});
