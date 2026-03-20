// ============================================================
// dashboard/server.js — Multi-Server Edition
// Discord OAuth login → guild picker → scoped admin panel
// Only server owners and admins can access their guild's data
// ============================================================

const express        = require('express');
const session        = require('express-session');
const path           = require('path');
const fs             = require('fs');
const db             = require('../utils/db');
const { guildCol, col } = require('../utils/mongo');

const app  = express();
const PORT = process.env.PORT || 3001;

const DISCORD_CLIENT_ID     = process.env.CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI          = process.env.DASHBOARD_URL
  ? `${process.env.DASHBOARD_URL}/auth/callback`
  : `http://localhost:${PORT}/auth/callback`;

app.use(express.json());
app.use(session({
  secret:            process.env.SESSION_SECRET || 'changeme_' + Math.random(),
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 24 * 60 * 60 * 1000 },
}));

// ── HELPERS ───────────────────────────────────────────────────

async function fetchDiscordAPI(endpoint, token) {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchBotAPI(endpoint) {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    headers: { Authorization: `Bot ${process.env.TOKEN}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// Check if user is admin/owner in a guild via bot API
async function isAdminInGuild(userId, guildId) {
  try {
    const member = await fetchBotAPI(`/guilds/${guildId}/members/${userId}`);
    if (!member) return false;
    // Owner check
    const guild = await fetchBotAPI(`/guilds/${guildId}`);
    if (guild?.owner_id === userId) return true;
    // Admin permission check (0x8 = ADMINISTRATOR)
    const roles      = await fetchBotAPI(`/guilds/${guildId}/roles`);
    const memberRoles = member.roles || [];
    return (roles || []).some(r => memberRoles.includes(r.id) && (BigInt(r.permissions) & 0x8n) === 0x8n);
  } catch { return false; }
}

// Auth middleware — requires login
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in', redirect: '/login.html' });
  next();
}

// Guild auth middleware — requires login + admin in guildId
async function requireGuildAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const guildId = req.params.guildId || req.query.guildId || req.body.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  const ok = await isAdminInGuild(req.session.user.id, guildId);
  if (!ok) return res.status(403).json({ error: 'You are not an admin in this server' });
  req.guildId = guildId;
  next();
}

// ── STATIC FILES ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── DISCORD OAUTH ─────────────────────────────────────────────

app.get('/auth/login', (req, res) => {
  const params = new URLSearchParams({
    client_id:     DISCORD_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         'identify guilds',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/login.html?error=no_code');

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/login.html?error=token_failed');

    // Get user info
    const user = await fetchDiscordAPI('/users/@me', tokenData.access_token);
    if (!user) return res.redirect('/login.html?error=user_failed');

    req.session.user        = { id: user.id, username: user.global_name || user.username, avatar: user.avatar };
    req.session.accessToken = tokenData.access_token;

    res.redirect('/guild-select.html');
  } catch (err) {
    console.error('OAuth error:', err);
    res.redirect('/login.html?error=oauth_error');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

app.get('/auth/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

// ── GUILD SELECTION ───────────────────────────────────────────

// Returns all guilds the logged-in user is an admin of (that the bot is also in)
app.get('/api/my-guilds', requireAuth, async (req, res) => {
  try {
    const userGuilds = await fetchDiscordAPI('/users/@me/guilds', req.session.accessToken);
    if (!userGuilds) return res.json([]);

    // Get guilds the bot is in
    const botGuilds = await fetchBotAPI('/users/@me/guilds');
    const botGuildIds = new Set((botGuilds || []).map(g => g.id));

    // Filter to guilds where: bot is present AND user is owner or has admin perms
    const adminGuilds = userGuilds.filter(g => {
      if (!botGuildIds.has(g.id)) return false;
      const isOwner = g.owner;
      const hasAdmin = (BigInt(g.permissions || 0) & 0x8n) === 0x8n;
      return isOwner || hasAdmin;
    }).map(g => ({
      id:   g.id,
      name: g.name,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
    }));

    res.json(adminGuilds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── STATS ─────────────────────────────────────────────────────

app.get('/api/:guildId/stats', requireGuildAuth, async (req, res) => {
  const guildId = req.guildId;
  const users   = await db.getAllUsers();
  const store   = await db.getStore();
  const config  = await db.getConfig(guildId);
  const userList = Object.values(users);
  const totalMoney = userList.reduce((s, u) => s + u.wallet + u.bank, 0);

  let totalMembers = userList.length;
  try {
    const guild = await fetchBotAPI(`/guilds/${guildId}?with_counts=true`);
    if (guild?.approximate_member_count) totalMembers = guild.approximate_member_count;
  } catch {}

  res.json({ totalUsers: userList.length, totalMembers, totalMoney, storeItems: (store.items||[]).length, purgeActive: config.purgeActive });
});

// ── USERS ─────────────────────────────────────────────────────

app.get('/api/:guildId/users', requireGuildAuth, async (req, res) => {
  const guildId = req.guildId;
  const accountUsers = await db.getAllUsers();
  const memberMap = {};

  // Start with account holders
  for (const [id, data] of Object.entries(accountUsers)) {
    memberMap[id] = { id, username: id, avatar: null, hasAccount: true, ...data };
  }

  // Enrich with Discord usernames from guild
  try {
    const members = await fetchBotAPI(`/guilds/${guildId}/members?limit=1000`);
    if (Array.isArray(members)) {
      for (const member of members) {
        if (!member.user || member.user.bot) continue;
        const u = member.user;
        if (!memberMap[u.id]) {
          memberMap[u.id] = { id:u.id, username:member.nick||u.global_name||u.username||u.id, avatar:u.avatar?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`:null, hasAccount:false, wallet:0, bank:0, total:0, bannedUntil:null };
        } else {
          memberMap[u.id].username = member.nick || u.global_name || u.username || u.id;
          memberMap[u.id].avatar   = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null;
        }
      }
    }
  } catch {}

  const list = Object.values(memberMap).map(m => ({
    id:          m.id,
    username:    m.username || m.id,
    avatar:      m.avatar || null,
    hasAccount:  m.hasAccount || false,
    wallet:      m.wallet  || 0,
    bank:        m.bank    || 0,
    total:       (m.wallet||0) + (m.bank||0),
    bannedUntil: m.bannedUntil || null,
  })).sort((a,b) => { if(a.hasAccount&&!b.hasAccount)return -1; if(!a.hasAccount&&b.hasAccount)return 1; return b.total-a.total; });

  res.json(list);
});

app.post('/api/:guildId/users/:id/money', requireGuildAuth, async (req, res) => {
  const user = await db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { wallet, bank } = req.body;
  if (wallet != null) user.wallet = Math.max(0, parseInt(wallet)||0);
  if (bank   != null) user.bank   = Math.max(0, parseInt(bank)||0);
  await db.saveUser(req.params.id, user);
  res.json({ success: true });
});

app.post('/api/:guildId/users/:id/unban', requireGuildAuth, async (req, res) => {
  const user = await db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.bannedUntil = null;
  await db.saveUser(req.params.id, user);
  res.json({ success: true });
});

app.post('/api/:guildId/users/:id/give-item', requireGuildAuth, async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  const store = await db.getStore();
  if (!(store.items||[]).find(i=>i.id===itemId)) return res.status(404).json({ error: 'Item not found' });
  await db.giveItem(req.params.id, itemId);
  res.json({ success: true });
});

app.post('/api/:guildId/users/:id/take-item', requireGuildAuth, async (req, res) => {
  const user = await db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const idx = (user.inventory||[]).indexOf(req.body.itemId);
  if (idx===-1) return res.status(400).json({ error: 'User does not have this item' });
  user.inventory.splice(idx,1);
  await db.saveUser(req.params.id, user);
  res.json({ success: true });
});

// ── STORE (GLOBAL) ────────────────────────────────────────────

app.get('/api/store', requireAuth, async (req, res) => res.json(await db.getStore()));

app.post('/api/store', requireAuth, async (req, res) => {
  const store = await db.getStore();
  const { name, description, price, type, roleReward, reusable, effect, requirements, enabled } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'name and price required' });
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  if ((store.items||[]).find(i=>i.id===id)) return res.status(400).json({ error: `Item "${id}" already exists.` });
  store.items = store.items || [];
  store.items.push({ id, name, description:description||'', price:parseInt(price)||100, type:type||'useable', reusable:reusable||false, roleReward:roleReward||null, effect:effect||null, requirements:requirements||null, enabled:enabled!==false });
  await db.saveStore(store);
  res.json({ success: true });
});

app.put('/api/store/:id', requireAuth, async (req, res) => {
  const store = await db.getStore();
  const idx   = (store.items||[]).findIndex(i=>i.id===req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Item not found' });
  store.items[idx] = { ...store.items[idx], ...req.body, id: req.params.id };
  await db.saveStore(store);
  res.json({ success: true, item: store.items[idx] });
});

app.delete('/api/store/:id', requireAuth, async (req, res) => {
  const store = await db.getStore();
  store.items  = (store.items||[]).filter(i=>i.id!==req.params.id);
  await db.saveStore(store);
  res.json({ success: true });
});

// ── CONFIG (PER-SERVER) ───────────────────────────────────────

app.get('/api/:guildId/config', requireGuildAuth, async (req, res) => res.json(await db.getConfig(req.guildId)));

app.post('/api/:guildId/config/prefix', requireGuildAuth, async (req, res) => {
  const { prefix } = req.body;
  if (!prefix || prefix.length > 5) return res.status(400).json({ error: 'Prefix must be 1-5 chars' });
  const config = await db.getConfig(req.guildId); config.prefix = prefix.trim();
  await db.saveConfig(req.guildId, config); res.json({ success: true });
});

app.post('/api/:guildId/config/restricted-role', requireGuildAuth, async (req, res) => {
  const config = await db.getConfig(req.guildId); config.restrictedRoleId = req.body.roleId || null;
  await db.saveConfig(req.guildId, config); res.json({ success: true });
});

app.post('/api/:guildId/config/purge-channel', requireGuildAuth, async (req, res) => {
  const config = await db.getConfig(req.guildId); config.purgeChannelId = req.body.channelId || null;
  await db.saveConfig(req.guildId, config); res.json({ success: true });
});

app.post('/api/:guildId/config/rob-cooldown', requireGuildAuth, async (req, res) => {
  const parsed = parseFloat(req.body.minutes);
  if (isNaN(parsed) || parsed < 0) return res.status(400).json({ error: 'Must be >= 0' });
  const config = await db.getConfig(req.guildId); config.robCooldownMinutes = parsed;
  await db.saveConfig(req.guildId, config); res.json({ success: true });
});

// ── PROTECTED ROLES (PER-SERVER) ─────────────────────────────

app.get('/api/:guildId/protected-roles', requireGuildAuth, async (req, res) => res.json((await db.getConfig(req.guildId)).protectedRoles||[]));

app.post('/api/:guildId/protected-roles', requireGuildAuth, async (req, res) => {
  const { roleId } = req.body; if (!roleId) return res.status(400).json({ error: 'roleId required' });
  const config = await db.getConfig(req.guildId); if (!config.protectedRoles) config.protectedRoles = [];
  if (config.protectedRoles.includes(roleId)) return res.status(400).json({ error: 'Already protected' });
  config.protectedRoles.push(roleId); await db.saveConfig(req.guildId, config); res.json({ success: true });
});

app.delete('/api/:guildId/protected-roles/:roleId', requireGuildAuth, async (req, res) => {
  const config = await db.getConfig(req.guildId);
  config.protectedRoles = (config.protectedRoles||[]).filter(r=>r!==req.params.roleId);
  await db.saveConfig(req.guildId, config); res.json({ success: true });
});

// ── ROLE INCOME (PER-SERVER) ──────────────────────────────────

app.get('/api/:guildId/roleincome', requireGuildAuth, async (req, res) => res.json((await db.getConfig(req.guildId)).roleIncome||{}));

app.post('/api/:guildId/roleincome', requireGuildAuth, async (req, res) => {
  const { roleId, name, amount, location, intervalHours } = req.body;
  if (!roleId||!name||!amount) return res.status(400).json({ error: 'roleId, name, amount required' });
  const config = await db.getConfig(req.guildId); if (!config.roleIncome) config.roleIncome = {};
  config.roleIncome[roleId] = { name:name.trim(), amount:parseInt(amount)||0, location:location||'wallet', intervalHours:parseFloat(intervalHours)||24 };
  await db.saveConfig(req.guildId, config); res.json({ success: true });
});

app.delete('/api/:guildId/roleincome/:roleId', requireGuildAuth, async (req, res) => {
  const config = await db.getConfig(req.guildId);
  if (!config.roleIncome?.[req.params.roleId]) return res.status(404).json({ error: 'Not found' });
  delete config.roleIncome[req.params.roleId]; await db.saveConfig(req.guildId, config); res.json({ success: true });
});

// ── PURGE (PER-SERVER) ────────────────────────────────────────

app.post('/api/:guildId/purge/start', requireGuildAuth, async (req, res) => {
  const config = await db.getConfig(req.guildId);
  if (config.purgeActive) return res.status(400).json({ error: 'Already active' });
  const allUsers = await db.getAllUsers();
  for (const id in allUsers) { allUsers[id].wallet += allUsers[id].bank; allUsers[id].bank = 0; }
  await db.saveAllUsers(allUsers);
  config.purgeActive = true; config.purgeStartTime = Date.now();
  await db.saveConfig(req.guildId, config); res.json({ success: true });
});

app.post('/api/:guildId/purge/end', requireGuildAuth, async (req, res) => {
  const config = await db.getConfig(req.guildId);
  config.purgeActive = false; config.purgeStartTime = null;
  await db.saveConfig(req.guildId, config); res.json({ success: true });
});

// ── GUILD ROLES (for dropdowns) ───────────────────────────────

app.get('/api/:guildId/guild/roles', requireGuildAuth, async (req, res) => {
  try {
    const roles = await fetchBotAPI(`/guilds/${req.guildId}/roles`);
    if (!roles) return res.status(500).json({ error: 'Failed to fetch roles' });
    res.json(roles.filter(r=>r.name!=='@everyone').sort((a,b)=>b.position-a.position).map(r=>({id:r.id,name:r.name,color:r.color})));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── EFFECTS (GLOBAL VIEW) ─────────────────────────────────────

app.get('/api/:guildId/effects', requireGuildAuth, async (req, res) => {
  try {
    const c    = await col('activeEffects');
    const docs = await c.find({}).toArray();
    res.json(Object.fromEntries(docs.map(d=>[d._id,d])));
  } catch { res.json({}); }
});

app.post('/api/:guildId/effects/:id/clear-shield', requireGuildAuth, async (req, res) => {
  try {
    const c = await col('activeEffects');
    await c.updateOne({ _id: req.params.id }, { $set: { shield: null } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LOTTERY (PER-SERVER) ──────────────────────────────────────

app.get('/api/:guildId/lottery', requireGuildAuth, async (req, res) => {
  try {
    const c   = await guildCol('lottery', req.guildId);
    const doc = await c.findOne({ _id: 'lottery' });
    res.json(doc || {});
  } catch { res.json({}); }
});

app.post('/api/:guildId/lottery/settings', requireGuildAuth, async (req, res) => {
  const { active, ticketPrice, intervalHours } = req.body;
  const config = await db.getConfig(req.guildId);
  if (!config.lottery) config.lottery = {};
  if (active        !== undefined) config.lottery.active        = active;
  if (ticketPrice   !== undefined) config.lottery.ticketPrice   = parseInt(ticketPrice)||100;
  if (intervalHours !== undefined) config.lottery.intervalHours = parseFloat(intervalHours)||24;
  await db.saveConfig(req.guildId, config); res.json({ success: true });
});

// ── GANGS (PER-SERVER) ────────────────────────────────────────

app.get('/api/:guildId/gangs', requireGuildAuth, async (req, res) => {
  try {
    const { getAllGangs, getAllWars } = require('../utils/gangDb');
    const gangs = Object.values(await getAllGangs(req.guildId)).sort((a,b)=>(b.rep||0)-(a.rep||0));
    const wars  = Object.values(await getAllWars(req.guildId)).filter(w=>w.endsAt>Date.now());
    res.json({ gangs, activeWars: wars });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/gangs/:id/delete', requireGuildAuth, async (req, res) => {
  try {
    const { deleteGang } = require('../utils/gangDb');
    await deleteGang(req.params.id, req.guildId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POLICE (PER-SERVER) ───────────────────────────────────────

app.get('/api/:guildId/police', requireGuildAuth, async (req, res) => {
  try {
    const c    = await guildCol('police', req.guildId);
    const docs = await c.find({ $or:[{heat:{$gt:0}},{jailUntil:{$ne:null}}] }).sort({ heat:-1 }).toArray();
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/police/:userId/clear', requireGuildAuth, async (req, res) => {
  try {
    const { savePoliceRecord } = require('../utils/gangDb');
    await savePoliceRecord(req.params.userId, { userId:req.params.userId, heat:0, arrests:0, jailUntil:null, offenses:[] }, req.guildId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BUSINESSES ────────────────────────────────────────────────

app.get('/api/:guildId/businesses', requireGuildAuth, async (req, res) => {
  try {
    const bizDb = require('../utils/bizDb');
    const all   = await bizDb.getAllBusinesses();
    res.json(Object.values(all).map(biz => {
      const type = bizDb.BIZ_TYPES[biz.type] || {};
      return { ...biz, typeName:type.name||biz.type, typeEmoji:type.emoji||'🏢', income:bizDb.calcIncome(biz), maxLevel:type.maxLevel||10 };
    }).sort((a,b)=>b.level-a.level));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CATCH-ALL → serve dashboard HTML ─────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🖥️  Dashboard running at http://0.0.0.0:${PORT}`);
});
