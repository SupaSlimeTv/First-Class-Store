// ============================================================
// dashboard/server.js
// Runs inside the same process as index.js — shares filesystem
// so data is always live and in sync.
// ============================================================

const express = require('express');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');

// dotenv already loaded by index.js
const db = require('../utils/db');

const app  = express();
const PORT = process.env.PORT || 3001;

const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI;
const OWNER_ID              = process.env.OWNER_ID;
const GUILD_ID              = process.env.GUILD_ID;

// ============================================================
// SESSION
// ============================================================
app.use(session({
  secret:            process.env.SESSION_SECRET || 'change-me',
  resave:            false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

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
// AUTH
// ============================================================
async function getAuthRole(userId) {
  if (!userId) return null;
  if (userId === OWNER_ID) return 'owner';
  try {
    const config = db.getConfig();
    const modRoleIds = Object.keys(config.modRoles || {});
    if (!modRoleIds.length) return null;
    const res = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`, { headers: { Authorization: `Bot ${process.env.TOKEN}` } });
    if (!res.ok) return null;
    const member = await res.json();
    return modRoleIds.some(r => (member.roles || []).includes(r)) ? 'mod' : null;
  } catch { return null; }
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect('/login.html');
}

function requireOwner(req, res, next) {
  if (req.session?.user?.role === 'owner') return next();
  return res.status(403).json({ error: 'Owner only' });
}

// ============================================================
// STATIC FILES
// ============================================================
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ============================================================
// OAUTH2
// ============================================================
app.get('/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) return res.send('OAuth2 not configured. Add DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, OWNER_ID to env vars.');
  const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: DISCORD_REDIRECT_URI, response_type: 'code', scope: 'identify' });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/login.html?error=no_code');
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: DISCORD_REDIRECT_URI }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) return res.redirect('/login.html?error=token_failed');
    const userRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const discordUser = await userRes.json();
    if (!discordUser.id) return res.redirect('/login.html?error=user_failed');
    const role = await getAuthRole(discordUser.id);
    if (!role) return res.redirect('/login.html?error=no_access');
    req.session.user = {
      id: discordUser.id,
      username: discordUser.global_name || discordUser.username,
      avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=64` : null,
      role,
    };
    res.redirect('/');
  } catch (e) { console.error('Auth error:', e); res.redirect('/login.html?error=server_error'); }
});

app.get('/auth/logout', (req, res) => { req.session.destroy(); res.redirect('/login.html'); });
app.get('/api/me', requireAuth, (req, res) => res.json(req.session.user));

app.use('/api/', requireAuth);

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
// USERS — reads live from db every time
// ============================================================
app.get('/api/users', async (req, res) => {
  const accountUsers = db.getAllUsers(); // fresh read from disk every call

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

app.post('/api/users/:id/money', requireOwner, (req, res) => {
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

app.post('/api/store', requireOwner, (req, res) => {
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

app.put('/api/store/:id', requireOwner, (req, res) => {
  const store = db.getStore();
  const idx   = (store.items||[]).findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  store.items[idx] = { ...store.items[idx], ...req.body, id: req.params.id };
  db.saveStore(store);
  res.json({ success: true, item: store.items[idx] });
});

app.delete('/api/store/:id', requireOwner, (req, res) => {
  const store = db.getStore();
  const before = (store.items||[]).length;
  store.items = (store.items||[]).filter(i => i.id !== req.params.id);
  if (store.items.length === before) return res.status(404).json({ error: 'Item not found' });
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

app.post('/api/effects/:id/clear-shield', requireOwner, (req, res) => {
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
app.post('/api/purge/start', requireOwner, (req, res) => {
  const config = db.getConfig();
  if (config.purgeActive) return res.status(400).json({ error: 'Already active' });
  const allUsers = db.getAllUsers();
  for (const id in allUsers) { allUsers[id].wallet += allUsers[id].bank; allUsers[id].bank = 0; }
  db.saveAllUsers(allUsers);
  config.purgeActive = true; config.purgeStartTime = Date.now(); db.saveConfig(config);
  res.json({ success: true });
});

app.post('/api/purge/end', requireOwner, (req, res) => {
  const config = db.getConfig();
  config.purgeActive = false; config.purgeStartTime = null; db.saveConfig(config);
  res.json({ success: true });
});

// ============================================================
// CONFIG
// ============================================================
app.get('/api/config', (req, res) => res.json(db.getConfig()));

app.post('/api/config/prefix', requireOwner, (req, res) => {
  const { prefix } = req.body;
  if (!prefix || prefix.length > 5) return res.status(400).json({ error: 'Prefix must be 1-5 chars' });
  const config = db.getConfig(); config.prefix = prefix.trim(); db.saveConfig(config);
  res.json({ success: true, prefix: config.prefix });
});

app.post('/api/config/restricted-role', requireOwner, (req, res) => {
  const config = db.getConfig(); config.restrictedRoleId = req.body.roleId || null; db.saveConfig(config);
  res.json({ success: true, restrictedRoleId: config.restrictedRoleId });
});

app.post('/api/config/purge-channel', requireOwner, (req, res) => {
  const config = db.getConfig(); config.purgeChannelId = req.body.channelId || null; db.saveConfig(config);
  res.json({ success: true, purgeChannelId: config.purgeChannelId });
});

app.post('/api/config/rob-cooldown', requireOwner, (req, res) => {
  const parsed = parseFloat(req.body.minutes);
  if (isNaN(parsed) || parsed < 0) return res.status(400).json({ error: 'Must be >= 0' });
  const config = db.getConfig(); config.robCooldownMinutes = parsed; db.saveConfig(config);
  res.json({ success: true, robCooldownMinutes: parsed });
});

// ============================================================
// PROTECTED ROLES
// ============================================================
app.get('/api/protected-roles', (req, res) => res.json(db.getConfig().protectedRoles || []));

app.post('/api/protected-roles', requireOwner, (req, res) => {
  const { roleId } = req.body;
  if (!roleId) return res.status(400).json({ error: 'roleId required' });
  const config = db.getConfig();
  if (!config.protectedRoles) config.protectedRoles = [];
  if (config.protectedRoles.includes(roleId)) return res.status(400).json({ error: 'Already protected' });
  config.protectedRoles.push(roleId); db.saveConfig(config);
  res.json({ success: true, protectedRoles: config.protectedRoles });
});

app.delete('/api/protected-roles/:roleId', requireOwner, (req, res) => {
  const config = db.getConfig();
  config.protectedRoles = (config.protectedRoles||[]).filter(r => r !== req.params.roleId);
  db.saveConfig(config);
  res.json({ success: true, protectedRoles: config.protectedRoles });
});

// ============================================================
// ROLE INCOME
// ============================================================
app.get('/api/roleincome', (req, res) => res.json(db.getConfig().roleIncome || {}));

app.post('/api/roleincome', requireOwner, (req, res) => {
  const { roleId, name, amount, location, intervalHours } = req.body;
  if (!roleId || !name || !amount) return res.status(400).json({ error: 'roleId, name, amount required' });
  const config = db.getConfig();
  if (!config.roleIncome) config.roleIncome = {};
  config.roleIncome[roleId] = { name: name.trim(), amount: parseInt(amount)||0, location: location||'wallet', intervalHours: parseFloat(intervalHours)||24 };
  db.saveConfig(config);
  res.json({ success: true });
});

app.delete('/api/roleincome/:roleId', requireOwner, (req, res) => {
  const config = db.getConfig();
  if (!config.roleIncome?.[req.params.roleId]) return res.status(404).json({ error: 'Not found' });
  delete config.roleIncome[req.params.roleId]; db.saveConfig(config);
  res.json({ success: true });
});

// ============================================================
// CATCH-ALL
// ============================================================
app.get('*', (req, res) => {
  if (req.session?.user) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  res.redirect('/login.html');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🖥️  Dashboard running at http://0.0.0.0:${PORT}`);
});
