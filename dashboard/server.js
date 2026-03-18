// ============================================================
// dashboard/server.js — Owner Dashboard Backend
// No login required — runs open on your Railway URL
// ============================================================

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const db = require('../utils/db');

const app  = express();
const PORT = process.env.PORT || 3001;

const GUILD_ID = process.env.GUILD_ID;

app.use(express.json());

// ============================================================
// USERNAME CACHE
// ============================================================
const usernameCache = {};
async function fetchDiscordUser(userId) {
  const now = Date.now();
  const cached = usernameCache[userId];
  if (cached && now - cached.cachedAt < 600_000) return cached;
  try {
    const res  = await fetch(`https://discord.com/api/v10/users/${userId}`, { headers: { Authorization: `Bot ${process.env.TOKEN}` } });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = {
      username: data.global_name || data.username || userId,
      avatar:   data.avatar ? `https://cdn.discordapp.com/avatars/${userId}/${data.avatar}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${parseInt(userId) % 5}.png`,
      cachedAt: now,
    };
    usernameCache[userId] = entry;
    return entry;
  } catch { return null; }
}

// ============================================================
// STATIC FILES
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// STATS
// ============================================================
app.get('/api/stats', async (req, res) => {
  const users  = db.getAllUsers();
  const store  = db.getStore();
  const config = db.getConfig();
  const userList   = Object.values(users);
  const totalMoney = userList.reduce((s, u) => s + u.wallet + u.bank, 0);
  let totalMembers = userList.length;
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}?with_counts=true`, { headers: { Authorization: `Bot ${process.env.TOKEN}` } });
    if (r.ok) { const g = await r.json(); totalMembers = g.approximate_member_count || totalMembers; }
  } catch {}
  res.json({ totalUsers: userList.length, totalMembers, totalMoney, storeItems: (store.items||[]).length, purgeActive: config.purgeActive, totalWarnings: 0, modRoles: Object.keys(config.modRoles||{}).length });
});

// ============================================================
// USERS
// ============================================================
app.get('/api/users', async (req, res) => {
  const accountUsers = db.getAllUsers();
  let guildMembers = [];
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=1000`, { headers: { Authorization: `Bot ${process.env.TOKEN}`, 'Cache-Control': 'no-cache' } });
    if (r.ok) guildMembers = (await r.json()).filter(m => !m.user.bot);
  } catch {}

  const memberMap = {};
  for (const member of guildMembers) {
    const u = member.user;
    memberMap[u.id] = { id: u.id, username: member.nick || u.global_name || u.username || u.id, avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${parseInt(u.id) % 5}.png` };
  }
  for (const id of Object.keys(accountUsers)) {
    if (!memberMap[id]) { const d = await fetchDiscordUser(id); memberMap[id] = { id, username: d?.username || id, avatar: d?.avatar || null }; }
  }

  const list = Object.values(memberMap).map(member => {
    const data = accountUsers[member.id] || null;
    return { id: member.id, username: member.username, avatar: member.avatar, hasAccount: data !== null, wallet: data?.wallet||0, bank: data?.bank||0, total: (data?.wallet||0)+(data?.bank||0), bannedUntil: data?.bannedUntil||null };
  });
  list.sort((a, b) => { if (a.hasAccount && !b.hasAccount) return -1; if (!a.hasAccount && b.hasAccount) return 1; return b.total - a.total; });
  res.json(list);
});

app.post('/api/users/:id/money', (req, res) => {
  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { wallet, bank } = req.body;
  if (wallet != null) user.wallet = Math.max(0, parseInt(wallet)||0);
  if (bank   != null) user.bank   = Math.max(0, parseInt(bank)||0);
  db.saveUser(req.params.id, user);
  res.json({ success: true });
});

app.post('/api/users/:id/unban', (req, res) => {
  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.bannedUntil = null; db.saveUser(req.params.id, user);
  res.json({ success: true });
});

// ============================================================
// STORE
// ============================================================
app.get('/api/store', (req, res) => res.json(db.getStore()));

app.post('/api/store', (req, res) => {
  const store = db.getStore();
  const { name, description, price, type, roleReward, reusable, effect, requirements, enabled } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'name and price required' });
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if ((store.items||[]).find(i => i.id === id)) return res.status(400).json({ error: `Item "${id}" already exists.` });
  store.items = store.items || [];
  store.items.push({ id, name, description: description||'', price: parseInt(price)||100, type: type||'useable', reusable: reusable||false, roleReward: roleReward||null, effect: effect||null, requirements: requirements||null, enabled: enabled !== false });
  db.saveStore(store);
  res.json({ success: true });
});

app.put('/api/store/:id', (req, res) => {
  const store = db.getStore();
  const idx   = (store.items||[]).findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  store.items[idx] = { ...store.items[idx], ...req.body, id: req.params.id };
  db.saveStore(store);
  res.json({ success: true, item: store.items[idx] });
});

app.delete('/api/store/:id', (req, res) => {
  const store = db.getStore();
  store.items = (store.items||[]).filter(i => i.id !== req.params.id);
  db.saveStore(store);
  res.json({ success: true });
});

// ============================================================
// EFFECTS
// ============================================================
app.get('/api/effects', (req, res) => {
  try { const f = path.join(__dirname, '../data/activeEffects.json'); res.json(fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}); }
  catch { res.json({}); }
});

app.post('/api/effects/:id/clear-shield', (req, res) => {
  try {
    const f = path.join(__dirname, '../data/activeEffects.json');
    const data = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    if (data[req.params.id]) { data[req.params.id].shield = null; fs.writeFileSync(f, JSON.stringify(data, null, 2)); }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// PURGE
// ============================================================
app.post('/api/purge/start', (req, res) => {
  const config = db.getConfig();
  if (config.purgeActive) return res.status(400).json({ error: 'Already active' });
  const allUsers = db.getAllUsers();
  for (const id in allUsers) { allUsers[id].wallet += allUsers[id].bank; allUsers[id].bank = 0; }
  db.saveAllUsers(allUsers);
  config.purgeActive = true; config.purgeStartTime = Date.now(); db.saveConfig(config);
  res.json({ success: true });
});

app.post('/api/purge/end', (req, res) => {
  const config = db.getConfig();
  config.purgeActive = false; config.purgeStartTime = null; db.saveConfig(config);
  res.json({ success: true });
});

// ============================================================
// CONFIG
// ============================================================
app.get('/api/config', (req, res) => res.json(db.getConfig()));

app.post('/api/config/prefix', (req, res) => {
  const { prefix } = req.body;
  if (!prefix || prefix.length > 5) return res.status(400).json({ error: 'Prefix must be 1-5 chars' });
  const config = db.getConfig(); config.prefix = prefix.trim(); db.saveConfig(config);
  res.json({ success: true, prefix: config.prefix });
});

app.post('/api/config/restricted-role', (req, res) => {
  const config = db.getConfig(); config.restrictedRoleId = req.body.roleId || null; db.saveConfig(config);
  res.json({ success: true, restrictedRoleId: config.restrictedRoleId });
});

app.post('/api/config/purge-channel', (req, res) => {
  const config = db.getConfig(); config.purgeChannelId = req.body.channelId || null; db.saveConfig(config);
  res.json({ success: true, purgeChannelId: config.purgeChannelId });
});

app.post('/api/config/rob-cooldown', (req, res) => {
  const parsed = parseFloat(req.body.minutes);
  if (isNaN(parsed) || parsed < 0) return res.status(400).json({ error: 'Must be >= 0' });
  const config = db.getConfig(); config.robCooldownMinutes = parsed; db.saveConfig(config);
  res.json({ success: true, robCooldownMinutes: parsed });
});

// ============================================================
// PROTECTED ROLES
// ============================================================
app.get('/api/protected-roles', (req, res) => res.json(db.getConfig().protectedRoles || []));

app.post('/api/protected-roles', (req, res) => {
  const { roleId } = req.body;
  if (!roleId) return res.status(400).json({ error: 'roleId required' });
  const config = db.getConfig();
  if (!config.protectedRoles) config.protectedRoles = [];
  if (config.protectedRoles.includes(roleId)) return res.status(400).json({ error: 'Already protected' });
  config.protectedRoles.push(roleId); db.saveConfig(config);
  res.json({ success: true, protectedRoles: config.protectedRoles });
});

app.delete('/api/protected-roles/:roleId', (req, res) => {
  const config = db.getConfig();
  config.protectedRoles = (config.protectedRoles||[]).filter(r => r !== req.params.roleId);
  db.saveConfig(config);
  res.json({ success: true, protectedRoles: config.protectedRoles });
});

// Get a user's inventory with item details
app.get('/api/users/:id/inventory', (req, res) => {
  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const store  = db.getStore();
  const inv    = user.inventory || [];
  const counts = inv.reduce((a, id) => { a[id] = (a[id]||0)+1; return a; }, {});
  const items  = Object.entries(counts).map(([id, cnt]) => {
    const item = (store.items||[]).find(i => i.id === id);
    return { id, count: cnt, name: item?.name || id, description: item?.description || '', reusable: item?.reusable || false, effect: item?.effect?.type || null };
  });
  res.json({ userId: req.params.id, items });
});

// ============================================================
// GUILD ROLES — for dropdowns in dashboard
// ============================================================
app.get('/api/guild/roles', async (req, res) => {
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`, {
      headers: { Authorization: `Bot ${process.env.TOKEN}` },
    });
    if (!r.ok) return res.status(500).json({ error: 'Failed to fetch roles' });
    const roles = await r.json();
    // Filter out @everyone and sort by position
    const filtered = roles
      .filter(role => role.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map(role => ({ id: role.id, name: role.name, color: role.color }));
    res.json(filtered);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// GIVE / TAKE ITEMS
// ============================================================
app.post('/api/users/:id/give-item', (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  const store = db.getStore();
  const item  = (store.items||[]).find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found in store' });
  db.giveItem(req.params.id, itemId);
  res.json({ success: true });
});

app.post('/api/users/:id/take-item', (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const inv = user.inventory || [];
  const idx = inv.indexOf(itemId);
  if (idx === -1) return res.status(400).json({ error: 'User does not have this item' });
  inv.splice(idx, 1);
  user.inventory = inv;
  db.saveUser(req.params.id, user);
  res.json({ success: true });
});

// ============================================================
// ROLE INCOME
// ============================================================
app.get('/api/roleincome', (req, res) => res.json(db.getConfig().roleIncome || {}));

app.post('/api/roleincome', (req, res) => {
  const { roleId, name, amount, location, intervalHours } = req.body;
  if (!roleId || !name || !amount) return res.status(400).json({ error: 'roleId, name, amount required' });
  const config = db.getConfig();
  if (!config.roleIncome) config.roleIncome = {};
  config.roleIncome[roleId] = { name: name.trim(), amount: parseInt(amount)||0, location: location||'wallet', intervalHours: parseFloat(intervalHours)||24 };
  db.saveConfig(config);
  res.json({ success: true });
});

app.delete('/api/roleincome/:roleId', (req, res) => {
  const config = db.getConfig();
  if (!config.roleIncome?.[req.params.roleId]) return res.status(404).json({ error: 'Not found' });
  delete config.roleIncome[req.params.roleId]; db.saveConfig(config);
  res.json({ success: true });
});

// ============================================================
// CATCH-ALL
// ============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🖥️  Dashboard running at http://0.0.0.0:${PORT}`);
});
