// ============================================================
// dashboard/server.js — Multi-Server Edition
// Discord OAuth login → guild picker → scoped admin panel
// Only server owners and admins can access their guild's data
// ============================================================

const express        = require('express');
const rateLimit      = require('express-rate-limit');
const session        = require('express-session');
const path           = require('path');
const fs             = require('fs');
const db             = require('../utils/db');
const { guildCol, col } = require('../utils/mongo');
const illuminatiDb   = require('../utils/illuminatiDb');
const creditDb       = require('../utils/creditDb');
const torDb          = require('../utils/torDb');

// ── SESSION STORE (MongoDB so sessions survive restarts) ──────
let sessionStore;
try {
  const MongoStore = require('connect-mongo');
  const mongoUri   = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (mongoUri) {
    sessionStore = MongoStore.create({
      mongoUrl:       mongoUri,
      collectionName: 'dashboardSessions',
      ttl:            7 * 24 * 60 * 60, // 7 days
    });
    console.log('✅ Dashboard sessions stored in MongoDB');
  }
} catch(e) { console.warn('connect-mongo not available, using memory sessions:', e.message); }

const app  = express();
const PORT = process.env.PORT || 3001;

const DISCORD_CLIENT_ID     = process.env.CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI          = process.env.DASHBOARD_URL
  ? `${process.env.DASHBOARD_URL}/auth/callback`
  : `http://localhost:${PORT}/auth/callback`;

app.use(express.json());

// ── RATE LIMITING ─────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.user?.id || req.ip, // rate limit per user not per IP
  skip: (req) => req.path.includes('/purge/') || req.path.includes('/config/') || req.path.includes('/store'),
  message: { error: 'Too many requests, slow down.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts.' },
});
app.use('/api/', apiLimiter);
app.use('/auth/', authLimiter);
app.set('trust proxy', 1);
app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  store:             sessionStore || undefined,
  cookie:            { secure: true, sameSite: 'none', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ── HELPERS ───────────────────────────────────────────────────

async function fetchDiscordAPI(endpoint, token) {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchBotAPI(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bot ${process.env.TOKEN}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, opts);
  if (!res.ok) return null;
  if (res.status === 204) return { ok: true };
  return res.json().catch(() => ({ ok: true }));
}

async function isAdminInGuild(userId, guildId) {
  try {
    const member = await fetchBotAPI(`/guilds/${guildId}/members/${userId}`);
    if (!member) return false;
    const guild = await fetchBotAPI(`/guilds/${guildId}`);
    if (guild?.owner_id === userId) return true;
    const roles      = await fetchBotAPI(`/guilds/${guildId}/roles`);
    const memberRoles = member.roles || [];
    return (roles || []).some(r => memberRoles.includes(r.id) && (BigInt(r.permissions) & 0x8n) === 0x8n);
  } catch { return false; }
}


// ── PAGINATED MEMBER FETCH (handles servers > 1000 members) ──
async function fetchAllMembers(guildId) {
  let all = [];
  let after = '0';
  while (true) {
    const batch = await fetchBotAPI(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    if (!batch || !batch.length) break;
    all = all.concat(batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }
  return all;
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in', redirect: '/login.html' });
  next();
}

async function requireGuildAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const guildId = req.params.guildId || req.query.guildId || req.body?.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  const ok = await isAdminInGuild(req.session.user.id, guildId);
  if (!ok) return res.status(403).json({ error: 'You are not an admin in this server' });
  req.guildId = guildId;
  db.setGuildContext(guildId);
  next();
}

// Owner-only: checks user is the actual guild owner via Discord API
async function requireOwnerAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const guildId = req.params.guildId || req.query.guildId || req.body?.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  try {
    const guild = await fetchBotAPI(`/guilds/${guildId}`);
    if (!guild || guild.owner_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Only the server owner can do this.' });
    }
    req.guildId = guildId;
    db.setGuildContext(guildId);
    next();
  } catch(e) { res.status(500).json({ error: e.message }); }
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

    // Debug: log what Discord actually returned
    const rawText = await tokenRes.text();
    console.log('OAuth token response status:', tokenRes.status);
    console.log('OAuth token response body:', rawText.substring(0, 300));

    let tokenData;
    try { tokenData = JSON.parse(rawText); }
    catch(e) {
      console.error('OAuth response was not JSON. CLIENT_ID:', DISCORD_CLIENT_ID ? 'SET' : 'MISSING', '| CLIENT_SECRET:', DISCORD_CLIENT_SECRET ? 'SET' : 'MISSING', '| REDIRECT_URI:', REDIRECT_URI);
      return res.redirect('/login.html?error=discord_returned_html');
    }

    if (!tokenData.access_token) {
      console.error('No access token. Discord error:', tokenData);
      return res.redirect('/login.html?error=token_failed');
    }
    const user = await fetchDiscordAPI('/users/@me', tokenData.access_token);
    if (!user) return res.redirect('/login.html?error=user_failed');
    req.session.user        = { id: user.id, username: user.global_name || user.username, avatar: user.avatar };
    req.session.accessToken = tokenData.access_token;
    req.session.save(async () => { try { await writeAudit('global', req.session.user?.id, 'login', { username: req.session.user?.username }); } catch {} res.redirect('/guild-select.html'); });
  } catch (err) {
    console.error('OAuth error:', err);
    res.redirect('/login.html?error=oauth_error');
  }
});

app.get('/auth/logout', (req, res) => { req.session.destroy(); res.redirect('/login.html'); });
app.get('/auth/me',     requireAuth, (req, res) => res.json(req.session.user));

// ── GUILD SELECTION ───────────────────────────────────────────

app.get('/api/my-guilds', requireAuth, async (req, res) => {
  try {
    if (!req.session.accessToken) {
      console.log('my-guilds: no access token in session for user', req.session.user?.id);
      return res.status(401).json({ error: 'Session expired', redirect: '/auth/login' });
    }

    const userGuilds = await fetchDiscordAPI('/users/@me/guilds', req.session.accessToken);
    if (!userGuilds) {
      console.log('my-guilds: Discord returned null for user guilds — token likely expired for', req.session.user?.id);
      // Token expired — clear it and tell frontend to re-login
      req.session.accessToken = null;
      req.session.save(()=>{});
      return res.status(401).json({ error: 'Discord token expired', redirect: '/auth/login' });
    }

    const botGuilds   = await fetchBotAPI('/users/@me/guilds');
    const botGuildIds = new Set((botGuilds || []).map(g => g.id));

    const adminGuilds = userGuilds.filter(g => g.owner || (BigInt(g.permissions || 0) & 0x8n) === 0x8n);

    const botPresent = adminGuilds.filter(g => botGuildIds.has(g.id)).map(g => ({
      id: g.id, name: g.name,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
      isOwner: !!g.owner,
    }));

    const addable = adminGuilds.filter(g => !botGuildIds.has(g.id)).map(g => ({
      id: g.id, name: g.name,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
    }));

    res.json({ botGuilds: botPresent, addableGuilds: addable, clientId: process.env.CLIENT_ID || '' });
  } catch (err) {
    console.error('my-guilds error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve dashboard for a specific guild — auth check then send index.html
app.get('/dashboard/:guildId', requireAuth, async (req, res) => {
  const ok = await isAdminInGuild(req.session.user.id, req.params.guildId);
  if (!ok) return res.redirect('/guild-select.html?error=no_access');
  // Store selected guild in session for global API routes (drugs, store)
  req.session.selectedGuild = req.params.guildId;
  req.session.guildId       = req.params.guildId;
  req.session.save(() => {});
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Return current session guild
app.get('/api/session-guild', requireAuth, (req, res) => {
  res.json({ guildId: req.session.selectedGuild || null });
});

// ── STATS ─────────────────────────────────────────────────────

app.get('/api/:guildId/stats', requireGuildAuth, async (req, res) => {
  const guildId  = req.guildId;
  const allUsers = db.getAllUsers();
  const store    = db.getStore(req.guildId);
  const config   = db.getConfig(guildId);

  // Get guild member IDs to filter to this server only
  let memberIds = new Set();
  let totalMembers = 0;
  try {
    const members = await fetchAllMembers(guildId);
    if (Array.isArray(members)) {
      members.forEach(m => { if (m.user?.id) memberIds.add(m.user.id); });
      totalMembers = memberIds.size;
    }
    // Also try approximate count for display
    const guild = await fetchBotAPI(`/guilds/${guildId}?with_counts=true`);
    if (guild?.approximate_member_count) totalMembers = guild.approximate_member_count;
  } catch {}

  // Only count users who are members of THIS guild
  const guildUsers = Object.entries(allUsers)
    .filter(([id]) => memberIds.size === 0 || memberIds.has(id))
    .map(([, u]) => u);

  const totalUsers = guildUsers.length;
  const totalMoney = guildUsers.reduce((s, u) => s + (u.wallet||0) + (u.bank||0), 0);

  res.json({ totalUsers, totalMembers, totalMoney, storeItems: (store.items||[]).length, purgeActive: config.purgeActive, prefix: config.prefix });
});

// ── USERS ─────────────────────────────────────────────────────

app.get('/api/:guildId/users', requireGuildAuth, async (req, res) => {
  const guildId = req.guildId;
  const allUsers = db.getAllUsers();

  try {
    // Fetch current guild members — only show people actually in the server
    const members = await fetchAllMembers(guildId);
    if (!Array.isArray(members)) return res.json([]);

    const { getPhone, getStatusTier } = require('../utils/phoneDb');
    const { getBusiness }             = require('../utils/bizDb');
    const { getGangByMember }         = require('../utils/gangDb');

    const list = members
      .filter(m => m.user && !m.user.bot)
      .map(m => {
        const u    = m.user;
        const data = allUsers[u.id] || {};

        // Phone/influencer
        const phone    = getPhone(u.id);
        const phoneTier= phone ? getStatusTier(phone.status||0) : null;

        // Business
        const bizList  = require('../utils/bizDb').getBusinesses(u.id);
        const biz      = bizList[0] || null;

        // Gang
        const gang     = getGangByMember(u.id);

        return {
          id:              u.id,
          username:        m.nick || u.global_name || u.username || u.id,
          avatar:          u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null,
          hasAccount:      !!allUsers[u.id],
          wallet:          data.wallet  || 0,
          bank:            data.bank    || 0,
          total:           (data.wallet || 0) + (data.bank || 0),
          bannedUntil:     data.bannedUntil || null,
          inventory:       data.inventory   || [],
          // Civil role data
          phoneType:       phone?.type || null,
          influencerTier:  phoneTier?.id || null,
          influencerLabel: phoneTier?.label || null,
          businessName:    biz?.name || null,
          businessType:    biz?.type || null,
          gangName:        gang?.name || null,
          gangId:          gang?.id   || null,
          isGangLeader:    gang?.leaderId === u.id,
          isIlluminati:    (() => { try { const org = illuminatiDb.getIlluminati(req.guildId); return !!(org?.members||[]).find(m2 => m2.userId === u.id); } catch { return false; } })(),
          artistTier:      (() => { try { const { getPhone } = require('../utils/phoneDb'); const p = getPhone(u.id); if (!p?.artistCareer) return 'unsigned'; return p.artistCareer.tier||'unsigned'; } catch { return 'unsigned'; } })(),
          artistTierLabel: (() => { try { const { getPhone, getArtistTier } = require('../utils/phoneDb'); const p = getPhone(u.id); if (!p?.artistCareer) return null; return getArtistTier(p.artistCareer.fame||0).label; } catch { return null; } })(),
        };
      })
      .sort((a, b) => {
        if (a.hasAccount && !b.hasAccount) return -1;
        if (!a.hasAccount && b.hasAccount) return 1;
        return b.total - a.total;
      });

    res.json(list);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/:guildId/users/:id/give-gun', requireGuildAuth, async (req, res) => {
  try {
    const { gunId } = req.body;
    if (!gunId) return res.status(400).json({ error: 'gunId required' });
    const { getGunShop, getGunInventory, saveGunInventory } = require('../utils/gunDb');
    const shop = getGunShop();
    const gun  = shop.guns.find(g => g.id === gunId);
    if (!gun) return res.status(404).json({ error: 'Gun not found' });
    const inv = getGunInventory(req.params.id);
    inv.push({ gunId, boughtAt: Date.now(), ammo: gun.capacity * 3, gifted: true });
    await saveGunInventory(req.params.id, inv);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/users/:id/pet-tokens', requireGuildAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ error: 'amount required' });
    const { getPet, savePet } = require('../utils/petDb');
    const pet = getPet(req.params.id);
    if (!pet) return res.status(404).json({ error: 'User does not have a pet' });
    pet.tokens = (pet.tokens||0) + parseInt(amount);
    savePet(req.params.id, pet);
    res.json({ success: true, tokens: pet.tokens });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/users/:id/pet-level', requireGuildAuth, async (req, res) => {
  try {
    const { level } = req.body;
    if (!level || level < 1) return res.status(400).json({ error: 'level required' });
    const { getPet, savePet, calcPetStats } = require('../utils/petDb');
    const pet = getPet(req.params.id);
    if (!pet) return res.status(404).json({ error: 'User does not have a pet' });
    pet.level  = parseInt(level);
    pet.xp     = 0;
    const stats = calcPetStats(pet);
    pet.hp     = stats.hp;
    savePet(req.params.id, pet);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PHONE / INFLUENCER GIVE-TAKE ──────────────────────────
app.post('/api/:guildId/users/:id/phone-status', requireGuildAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount == null) return res.status(400).json({ error: 'amount required' });
    const { getPhone, savePhone } = require('../utils/phoneDb');
    const phone = getPhone(req.params.id);
    if (!phone) return res.status(404).json({ error: 'User does not have a phone' });
    phone.status = Math.max(0, (phone.status||0) + parseInt(amount));
    await savePhone(req.params.id, phone);
    await writeAudit(req.guildId, req.session.user?.id, amount > 0 ? 'give_status' : 'take_status', { amount: Math.abs(amount), target: `<@${req.params.id}>` });
    res.json({ success: true, status: phone.status });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/users/:id/phone-followers', requireGuildAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount == null) return res.status(400).json({ error: 'amount required' });
    const { getPhone, savePhone } = require('../utils/phoneDb');
    const phone = getPhone(req.params.id);
    if (!phone) return res.status(404).json({ error: 'User does not have a phone' });
    phone.followers = Math.max(0, (phone.followers||0) + parseInt(amount));
    await savePhone(req.params.id, phone);
    res.json({ success: true, followers: phone.followers });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/users/:id/phone-hype', requireGuildAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount == null) return res.status(400).json({ error: 'amount required' });
    const { getPhone, savePhone } = require('../utils/phoneDb');
    const phone = getPhone(req.params.id);
    if (!phone) return res.status(404).json({ error: 'User does not have a phone' });
    phone.hype = Math.max(0, (phone.hype||0) + parseInt(amount));
    await savePhone(req.params.id, phone);
    await writeAudit(req.guildId, req.session.user?.id, amount > 0 ? 'give_hype' : 'take_hype', { amount: Math.abs(amount), target: `<@${req.params.id}>` });
    res.json({ success: true, hype: phone.hype });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/users/:id/phone-deal', requireGuildAuth, async (req, res) => {
  try {
    const { name, payout } = req.body;
    if (!name || !payout) return res.status(400).json({ error: 'name and payout required' });
    const { getPhone, savePhone } = require('../utils/phoneDb');
    const phone = getPhone(req.params.id);
    if (!phone) return res.status(404).json({ error: 'User does not have a phone' });
    phone.sponsorDeals = [...(phone.sponsorDeals||[]), { name, payout: parseInt(payout), active: true, createdAt: Date.now(), adminGranted: true }];
    await savePhone(req.params.id, phone);
    await writeAudit(req.guildId, req.session.user?.id, 'give_deal', { name, payout, target: `<@${req.params.id}>` });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/users/:id/phone-shoutout-mult', requireGuildAuth, async (req, res) => {
  try {
    const { mult } = req.body;
    if (mult == null) return res.status(400).json({ error: 'mult required' });
    const { getPhone, savePhone } = require('../utils/phoneDb');
    const phone = getPhone(req.params.id);
    if (!phone) return res.status(404).json({ error: 'User does not have a phone' });
    phone.coinShoutoutMult = Math.max(0.1, parseFloat(mult));
    await savePhone(req.params.id, phone);
    await writeAudit(req.guildId, req.session.user?.id, 'edit_shoutout_power', { mult: phone.coinShoutoutMult, target: `<@${req.params.id}>` });
    res.json({ success: true, mult: phone.coinShoutoutMult });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/users/:id/money', requireGuildAuth, async (req, res) => {
  const user = db.getOrCreateUser(req.params.id);
  const { wallet, bank, addWallet, setWallet, setBank, announce, announceType } = req.body;
  if (wallet    != null) user.wallet = Math.max(0, parseInt(wallet)||0);
  if (bank      != null) user.bank   = Math.max(0, parseInt(bank)||0);
  if (setWallet != null) user.wallet = Math.max(0, parseInt(setWallet)||0);
  if (setBank   != null) user.bank   = Math.max(0, parseInt(setBank)||0);
  const added = parseInt(addWallet)||0;
  if (added !== 0) user.wallet = Math.max(0, user.wallet + added);
  db.saveUser(req.params.id, user);

  // Audit log
  if (added > 0) await writeAudit(req.guildId, req.session.user?.id, 'give_money', { amount: added, target: `<@${req.params.id}>` });
  else if (added < 0) await writeAudit(req.guildId, req.session.user?.id, 'take_money', { amount: Math.abs(added), target: `<@${req.params.id}>` });

  // Announce in purge/announcement channel if requested
  if (announce && added !== 0) {
    try {
      const config    = db.getConfig(req.params.guildId || req.guildId);
      const channelId = config.purgeChannelId;
      if (channelId) {
        const { EmbedBuilder } = require('discord.js');
        // We need the bot client — import it via a shared reference
        const botClient = require('../index.client');
        if (botClient) {
          const channel = await botClient.channels.fetch(channelId).catch(() => null);
          if (channel) {
            const isStimulus = announceType === 'stimulus';
            const amt        = Math.abs(added);
            const embed = new EmbedBuilder()
              .setColor(isStimulus ? 0x2ecc71 : 0xff3b3b)
              .setTitle(isStimulus ? '💵 Stimulus Check' : '🏛️ Government Tax')
              .setDescription(isStimulus
                ? `<@${req.params.id}> was given a stimulus check of **$${amt.toLocaleString()}**!`
                : `<@${req.params.id}> was taxed by the government **$${amt.toLocaleString()}**.`)
              .setTimestamp();
            await channel.send({ embeds: [embed] });
          }
        }
      }
    } catch(e) { console.error('announce error:', e.message); }
  }

  res.json({ success: true });
});

app.post('/api/:guildId/users/:id/unban', requireGuildAuth, async (req, res) => {
  const user = db.getOrCreateUser(req.params.id);
  user.bannedUntil = null;
  db.saveUser(req.params.id, user);
  res.json({ success: true });
});

app.get('/api/:guildId/users/:id/inventory', requireGuildAuth, async (req, res) => {
  const user  = db.getUser(req.params.id);
  const store = db.getStore(req.guildId);

  // Store items
  const items = (user?.inventory || []).reduce((acc, id) => {
    const item = (store.items||[]).find(i => i.id === id);
    if (!item) return acc;
    const ex = acc.find(a => a.id === id);
    if (ex) ex.count++; else acc.push({ ...item, count: 1 });
    return acc;
  }, []);

  // Gun inventory
  const { getGunInventory, getGunById } = require('../utils/gunDb');
  const gunInv = getGunInventory(req.params.id);
  const guns = gunInv.map(entry => {
    const gun = getGunById(entry.gunId);
    if (!gun) return null;
    return { id: entry.gunId, name: gun.name, description: gun.desc, emoji: gun.emoji,
      type: 'gun', rarity: gun.rarity, ammo: entry.ammo, price: gun.price,
      hasSwitch: gun.hasSwitch, count: 1, isGun: true };
  }).filter(Boolean);

  // Pet
  const { getPet, PET_TYPES } = require('../utils/petDb');
  const petData = getPet(req.params.id);
  let pet = null;
  if (petData) {
    const pType = PET_TYPES[petData.type] || {};
    pet = {
      name: petData.name, type: petData.type, emoji: pType.emoji || '🐾',
      rarity: pType.rarity || 'Common', tier: pType.tier || 1,
      level: petData.level || 1, hp: petData.hp, hunger: petData.hunger,
      happiness: petData.happiness, tokens: petData.tokens || 0,
      guardMode: petData.guardMode || false,
    };
  }

  // Phone
  const { getPhone, PHONE_TYPES, getStatusTier } = require('../utils/phoneDb');
  const phoneData = getPhone(req.params.id);
  let phone = null;
  if (phoneData) {
    const pType = PHONE_TYPES[phoneData.type] || PHONE_TYPES.standard;
    const tier  = getStatusTier(phoneData.status || 0);
    phone = {
      type: phoneData.type, name: pType.name, emoji: pType.emoji,
      status: phoneData.status || 0, tier: tier.label,
      followers: phoneData.followers || 0, hype: phoneData.hype || 0,
      totalPosts: phoneData.totalPosts || 0,
      totalEarned: phoneData.totalEarned || 0,
      activeSponsorDeals: (phoneData.sponsorDeals||[]).filter(s=>s.active).length,
      streak: phoneData.streak || 0,
    };
  }

  res.json({ items, guns, pet, phone });
});

app.post('/api/:guildId/users/:id/give-item', requireGuildAuth, async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  db.giveItem(req.params.id, itemId);
  await writeAudit(req.guildId, req.session.user?.id, 'give_item', { item: itemId, target: `<@${req.params.id}>` });
  res.json({ success: true });
});

app.post('/api/:guildId/users/:id/take-item', requireGuildAuth, async (req, res) => {
  const removed = db.removeItem(req.params.id, req.body.itemId);
  if (!removed) return res.status(400).json({ error: 'User does not have this item' });
  await writeAudit(req.guildId, req.session.user?.id, 'take_item', { item: req.body.itemId, target: `<@${req.params.id}>` });
  res.json({ success: true });
});

app.post('/api/:guildId/users/:id/take-gun', requireGuildAuth, async (req, res) => {
  try {
    const { gunId } = req.body;
    if (!gunId) return res.status(400).json({ error: 'gunId required' });
    const { getGunInventory, saveGunInventory } = require('../utils/gunDb');
    const inv = getGunInventory(req.params.id);
    const idx = inv.findIndex(g => g.gunId === gunId);
    if (idx === -1) return res.status(400).json({ error: 'User does not have this gun' });
    inv.splice(idx, 1);
    await saveGunInventory(req.params.id, inv);
    await writeAudit(req.guildId, req.session.user?.id, 'take_gun', { item: gunId, target: `<@${req.params.id}>` });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STORE (GLOBAL) ────────────────────────────────────────────

app.get('/api/store', requireAuth, (req, res) => { const gid = req.query.guildId || req.session.guildId; if(gid) db.setGuildContext(gid); res.json(db.getStore(gid)); });

app.post('/api/store', requireAuth, async (req, res) => {
  const store = db.getStore(req.guildId);
  const { name, description, price, type, roleReward, reusable, effect, requirements, enabled, trigger, isDrug, isWeapon } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'name and price required' });
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  if ((store.items||[]).find(i=>i.id===id)) return res.status(400).json({ error: `Item "${id}" already exists.` });
  store.items = store.items || [];
  store.items.push({ id, name, description:description||'', price:parseInt(price)||100, type:type||'useable', reusable:reusable||false, roleReward:roleReward||null, effect:effect||null, requirements:requirements||null, enabled:enabled!==false, trigger:trigger||'use', isDrug:!!isDrug, isWeapon:!!isWeapon });
  db.saveStore(store);
  await writeAudit('global', req.session.user?.id, 'add_store_item', { name, id });
  res.json({ success: true });
});

app.put('/api/store/:id', requireAuth, async (req, res) => {
  const store = db.getStore(req.guildId);
  const idx   = (store.items||[]).findIndex(i=>i.id===req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Item not found' });
  store.items[idx] = { ...store.items[idx], ...req.body, id: req.params.id };
  db.saveStore(store);
  await writeAudit('global', req.session.user?.id, 'edit_store_item', { name: store.items[idx].name, id: req.params.id });
  res.json({ success: true, item: store.items[idx] });
});

app.delete('/api/store/:id', requireAuth, async (req, res) => {
  const store = db.getStore(req.guildId);
  const item  = (store.items||[]).find(i=>i.id===req.params.id);
  store.items  = (store.items||[]).filter(i=>i.id!==req.params.id);
  db.saveStore(store);
  await writeAudit('global', req.session.user?.id, 'delete_store_item', { name: item?.name||req.params.id, id: req.params.id });
  res.json({ success: true });
});

// ── CONFIG (PER-SERVER) ───────────────────────────────────────

app.get('/api/:guildId/config', requireGuildAuth, (req, res) => res.json(db.getConfig(req.guildId)));

app.post('/api/:guildId/config/prefix', requireGuildAuth, async (req, res) => {
  const { prefix } = req.body;
  if (!prefix || prefix.length > 5) return res.status(400).json({ error: 'Prefix must be 1-5 chars' });
  const config = db.getConfig(req.guildId); config.prefix = prefix.trim();
  db.saveConfig(req.guildId, config); res.json({ success: true, prefix: config.prefix });
});

app.post('/api/:guildId/config/restricted-role', requireGuildAuth, (req, res) => {
  const config = db.getConfig(req.guildId); config.restrictedRoleId = req.body.roleId || null;
  db.saveConfig(req.guildId, config); res.json({ success: true, restrictedRoleId: config.restrictedRoleId });
});

app.post('/api/:guildId/config/purge-channel', requireGuildAuth, (req, res) => {
  const config = db.getConfig(req.guildId); config.purgeChannelId = req.body.channelId || null;
  db.saveConfig(req.guildId, config); res.json({ success: true, purgeChannelId: config.purgeChannelId });
});

app.post('/api/:guildId/config/rob-cooldown', requireGuildAuth, (req, res) => {
  const parsed = parseFloat(req.body.minutes);
  if (isNaN(parsed) || parsed < 0) return res.status(400).json({ error: 'Must be >= 0' });
  const config = db.getConfig(req.guildId); config.robCooldownMinutes = parsed;
  db.saveConfig(req.guildId, config); res.json({ success: true });
});

app.post('/api/:guildId/config/shot-timeout', requireGuildAuth, (req, res) => {
  const parsed = parseFloat(req.body.minutes);
  if (isNaN(parsed) || parsed < 0) return res.status(400).json({ error: 'Must be >= 0' });
  const config = db.getConfig(req.guildId); config.shotTimeoutMinutes = parsed;
  db.saveConfig(req.guildId, config); res.json({ success: true });
});

// ── PROTECTED ROLES ───────────────────────────────────────────

app.get('/api/:guildId/protected-roles', requireGuildAuth, (req, res) => res.json((db.getConfig(req.guildId)).protectedRoles||[]));

app.post('/api/:guildId/protected-roles', requireGuildAuth, (req, res) => {
  const { roleId } = req.body; if (!roleId) return res.status(400).json({ error: 'roleId required' });
  const config = db.getConfig(req.guildId); if (!config.protectedRoles) config.protectedRoles = [];
  if (config.protectedRoles.includes(roleId)) return res.status(400).json({ error: 'Already protected' });
  config.protectedRoles.push(roleId); db.saveConfig(req.guildId, config); res.json({ success: true });
});

app.delete('/api/:guildId/protected-roles/:roleId', requireGuildAuth, (req, res) => {
  const config = db.getConfig(req.guildId);
  config.protectedRoles = (config.protectedRoles||[]).filter(r=>r!==req.params.roleId);
  db.saveConfig(req.guildId, config); res.json({ success: true });
});

// ── ROLE INCOME ───────────────────────────────────────────────

app.get('/api/:guildId/roleincome', requireGuildAuth, (req, res) => res.json((db.getConfig(req.guildId)).roleIncome||{}));

app.post('/api/:guildId/roleincome', requireGuildAuth, (req, res) => {
  const { roleId, name, amount, location, intervalHours } = req.body;
  if (!roleId||!name||!amount) return res.status(400).json({ error: 'roleId, name, amount required' });
  const config = db.getConfig(req.guildId); if (!config.roleIncome) config.roleIncome = {};
  config.roleIncome[roleId] = { name:name.trim(), amount:parseInt(amount)||0, location:location||'wallet', intervalHours:parseFloat(intervalHours)||24 };
  db.saveConfig(req.guildId, config); res.json({ success: true });
});

app.delete('/api/:guildId/roleincome/:roleId', requireGuildAuth, (req, res) => {
  const config = db.getConfig(req.guildId);
  if (!config.roleIncome?.[req.params.roleId]) return res.status(404).json({ error: 'Not found' });
  delete config.roleIncome[req.params.roleId]; db.saveConfig(req.guildId, config); res.json({ success: true });
});

// ── PURGE ─────────────────────────────────────────────────────

app.post('/api/:guildId/purge/start', requireGuildAuth, async (req, res) => {
  await writeAudit(req.guildId, req.session.user?.id, 'purge_start', {});
  const config = db.getConfig(req.guildId);
  if (config.purgeActive) return res.status(400).json({ error: 'Already active' });

  // Drain bank → wallet for users in THIS guild only
  try {
    const botClient  = require('../index.client');
    const members    = await fetchAllMembers(req.guildId);
    const memberIds  = new Set((members||[]).map(m => m.user?.id).filter(Boolean));
    const allUsers   = db.getAllUsers();
    for (const id in allUsers) {
      if (!memberIds.has(id)) continue; // only this guild's members
      const u = allUsers[id];
      if ((u.bank||0) > 0) {
        u.wallet = (u.wallet||0) + (u.bank||0);
        u.bank   = 0;
        db.saveUser(id, u);
      }
    }
  } catch(e) { console.error('Purge drain error:', e.message); }

  config.purgeActive = true; config.purgeStartTime = Date.now();
  db.saveConfig(req.guildId, config);
  res.json({ success: true });
});

app.post('/api/:guildId/config/purge-gif', requireGuildAuth, async (req, res) => {
  const config = db.getConfig(req.guildId);
  config.purgeStartGif = req.body.startGif || null;
  config.purgeEndGif   = req.body.endGif   || null;
  db.saveConfig(req.guildId, config);
  res.json({ success: true });
});

app.post('/api/:guildId/purge/end', requireGuildAuth, async (req, res) => { await writeAudit(req.guildId, req.session.user?.id, 'purge_end', {});
  const config = db.getConfig(req.guildId);
  config.purgeActive = false; config.purgeStartTime = null;
  db.saveConfig(req.guildId, config); res.json({ success: true });
});

// ── GREAT DEPRESSION ──────────────────────────────────────────
app.post('/api/:guildId/depression/start', requireOwnerAuth, async (req, res) => {
  try {
    await writeAudit(req.guildId, req.session.user?.id, 'depression_start', {});
    const config = db.getConfig(req.guildId);
    if (config.depressionActive) return res.status(400).json({ error: 'Depression already active' });

    // Fetch guild members via bot and wipe their economy
    const members = await fetchAllMembers(req.guildId);
    const memberIds = new Set((members||[]).map(m => m.user?.id).filter(Boolean));
    const allUsers  = db.getAllUsers();
    let wiped = 0;
    for (const [id, u] of Object.entries(allUsers)) {
      if (!memberIds.has(id)) continue;
      u.wallet = 0; u.bank = 0;
      db.saveUser(id, u);
      wiped++;
    }

    config.depressionActive    = true;
    config.depressionStartTime = Date.now();
    config.depressionBy        = req.session.user?.id;
    db.saveConfig(req.guildId, config);
    res.json({ success: true, wiped });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/depression/end', requireOwnerAuth, async (req, res) => {
  try {
    await writeAudit(req.guildId, req.session.user?.id, 'depression_end', {});
    const config = db.getConfig(req.guildId);
    config.depressionActive    = false;
    config.depressionStartTime = null;
    db.saveConfig(req.guildId, config);

    // Pay $200 survival payment to every member in this guild
    const SURVIVAL_PAY = 200;
    const members = await fetchAllMembers(req.guildId);
    const memberIds = new Set((members||[]).map(m => m.user?.id).filter(Boolean));
    let paid = 0;
    for (const id of memberIds) {
      if (!db.hasAccount(id)) continue;
      const u = db.getOrCreateUser(id);
      u.wallet = (u.wallet||0) + SURVIVAL_PAY;
      db.saveUser(id, u);
      paid++;
    }

    res.json({ success: true, paid, survivalPay: SURVIVAL_PAY });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/config/depression-gif', requireOwnerAuth, async (req, res) => {
  const config = db.getConfig(req.guildId);
  config.depressionGif = req.body.gifUrl || null;
  db.saveConfig(req.guildId, config);
  res.json({ success: true });
});

// ── CREDIT SCORE ADJUST ──────────────────────────────────────
app.post('/api/:guildId/users/:id/credit-score', requireGuildAuth, async (req, res) => {
  try {
    const { adjustScore } = require('./utils/creditDb');
    const delta = parseInt(req.body.delta)||0;
    const newScore = await adjustScore(req.params.id, delta, `Admin adjustment by ${req.session.user?.username}`);
    await writeAudit(req.guildId, req.session.user?.id, 'credit_score_adjust', { target:req.params.id, delta, newScore });
    res.json({ success:true, newScore });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── ILLUMINATI RANK SET ───────────────────────────────────────
app.post('/api/:guildId/users/:id/illuminati-rank', requireGuildAuth, async (req, res) => {
  try {
    const org = illuminatiDb.getIlluminati(req.guildId);
    if (!org) return res.status(400).json({ error:'No Illuminati in this server.' });
    const mem = (org.members||[]).find(m => m.userId === req.params.id);
    if (!mem) return res.status(400).json({ error:'User is not an Illuminati member.' });
    mem.rank = req.body.rank || 'initiate';
    await saveIlluminati(req.guildId, org);
    await writeAudit(req.guildId, req.session.user?.id, 'illuminati_rank', { target:req.params.id, rank:mem.rank });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});


// ── ILLUMINATI DASHBOARD ──────────────────────────────────────
app.get('/api/:guildId/illuminati', requireGuildAuth, async (req, res) => {
  try {
    const org = illuminatiDb.getIlluminati(req.guildId);
    res.json({ org: org || null });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/:guildId/illuminati/excommunicate', requireGuildAuth, async (req, res) => {
  try {
    const org = illuminatiDb.getIlluminati(req.guildId);
    if (!org) return res.status(400).json({ error:'No Illuminati.' });
    org.members = (org.members||[]).filter(m => m.userId !== req.body.userId);
    await illuminatiDb.saveIlluminati(req.guildId, org);
    await writeAudit(req.guildId, req.session.user?.id, 'illum_excommunicate', { userId:req.body.userId });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── CREDIT SCORES DASHBOARD ───────────────────────────────────
app.get('/api/:guildId/credit-scores', requireGuildAuth, async (req, res) => {
  try {
    const { getCreditTier } = creditDb;
    const filterTier = req.query.filter || 'all';

    // Pull fresh from MongoDB — dashboard process cache may be stale
    const creditCol = await col('credit');
    const allDocs   = await creditCol.find({}).toArray();

    // Get guild member IDs
    const members   = await fetchAllMembers(req.guildId);
    const memberIds = new Set((members||[]).map(m=>m.user?.id).filter(Boolean));

    let profiles = allDocs
      .filter(p => memberIds.has(p._id))
      .map(p => {
        const tier = getCreditTier(p.score||680);
        return {
          userId:  p._id,
          score:   p.score  || 680,
          tier:    tier.label,
          card:    p.card   || null,
          balance: p.balance|| 0,
          frozen:  !!p.frozen,
          loans:   (p.loans||[]).filter(l=>!l.paid).length,
          ssn:     p.ssn    || null,
        };
      });

    if (filterTier !== 'all') {
      const ranges = { excellent:[800,850], verygood:[740,799], good:[670,739], fair:[580,669], poor:[300,579] };
      const [min,max] = ranges[filterTier]||[0,850];
      profiles = profiles.filter(p => p.score>=min && p.score<=max);
    }
    profiles.sort((a,b) => b.score - a.score);
    res.json({ profiles });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── LAPTOP APP BATCH CREATE ───────────────────────────────────
app.post('/api/:guildId/store/create-apps', requireGuildAuth, async (req, res) => {
  try {
    const apps = req.body.apps || [];
    if (!apps.length || apps.length > 7) return res.status(400).json({ error:'1-7 apps per batch.' });
    const store = db.getStore(req.guildId);
    for (const app of apps) {
      const id = app.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,30) + '-' + Date.now().toString(36);
      store.items.push({
        id, name:app.name, price:app.price, description:`${app.name} — laptop hacking app. Quality Tier ${app.quality}.`,
        type:'useable', enabled:true, reusable:false, emoji:'💻',
        effect:{ type:'laptop_app', appId:app.appType, quality:app.quality||1, ...(app.successOverride?{ successOverride:app.successOverride }:{}) },
      });
    }
    db.saveStore(store, req.guildId);
    await writeAudit(req.guildId, req.session.user?.id, 'create_apps', { count:apps.length });
    res.json({ success:true, created:apps.length });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── TOR DASHBOARD ─────────────────────────────────────────────
app.get('/api/:guildId/tor', requireGuildAuth, async (req, res) => {
  try {
    const { getAllListings, getActiveListings } = torDb;
    const config   = db.getConfig(req.guildId);
    const all      = Object.values(getAllListings());
    const now      = Date.now();
    const volume   = all.reduce((s,l) => s+(l.price||0), 0);
    const enriched = all.map(l => {
      if (l.isLeak) {
        const u = db.getUser(l.victimId);
        return { ...l, victimWealth: (u?.wallet||0)+(u?.bank||0) };
      }
      return l;
    });
    res.json({
      listings: enriched.sort((a,b) => (b.createdAt||0)-(a.createdAt||0)).slice(0,100),
      tracedCount: all.filter(l=>l.traced).length,
      totalVolume: volume,
      config: { maxLeaks:config.torMaxLeaks||5, leakInterval:config.torLeakInterval||6, leakCount:config.torLeakCount||2 },
    });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/:guildId/tor/config', requireGuildAuth, async (req, res) => {
  try {
    const config = db.getConfig(req.guildId);
    config.torMaxLeaks     = parseInt(req.body.maxLeaks)     || 5;
    config.torLeakInterval = parseInt(req.body.leakInterval) || 6;
    config.torLeakCount    = parseInt(req.body.leakCount)    || 2;
    db.saveConfig(req.guildId, config);
    await writeAudit(req.guildId, req.session.user?.id, 'tor_config', req.body);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/:guildId/tor/trigger-leak', requireGuildAuth, async (req, res) => {
  try {
    const { createDataLeak, getActiveListings } = torDb;
    const config      = db.getConfig(req.guildId);
    const maxLeaks    = config.torMaxLeaks  || 5;
    const leakCount   = Math.min(config.torLeakCount || 2, 10);
    const activeLeaks = getActiveListings().filter(l => l.isLeak).length;
    const canLeak     = Math.max(0, maxLeaks - activeLeaks);
    if (!canLeak) return res.status(400).json({ error: `At max leaks (${maxLeaks}) — remove some or increase the limit.` });

    // Always pull fresh from MongoDB so dashboard process has current data
    const creditCol = await col('credit');
    const creditDocs= await creditCol.find({ ssn: { $exists: true } }).toArray();
    if (!creditDocs.length) return res.status(400).json({ error: 'No users with SSNs yet. Users get one when they open an account.' });

    const toLeakCount = Math.min(canLeak, leakCount, creditDocs.length);
    const victims     = creditDocs.sort(() => Math.random() - 0.5).slice(0, toLeakCount);
    let leaked = 0;

    for (const credit of victims) {
      const userId = credit._id;
      const listing = await createDataLeak(userId, {
        ssn:   credit.ssn,
        score: credit.score || 680,
        card:  credit.card  || null,
        limit: credit.limit || 0,
      });
      if (listing) {
        leaked++;
        // Write a pending DM notification so the bot process picks it up
        try {
          const notifCol = await col('pendingNotifications');
          await notifCol.insertOne({
            type:      'data_leak_victim',
            userId,
            listingId: listing.id,
            price:     listing.price,
            createdAt: Date.now(),
            sent:      false,
          });
        } catch {}
      }
    }

    await writeAudit(req.guildId, req.session.user?.id, 'tor_manual_leak', { leaked });
    res.json({ success: true, leaked });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/tor/clear-expired', requireGuildAuth, async (req, res) => {
  try {
    const { getAllListings, saveListing } = torDb;
    const all = getAllListings();
    const now = Date.now();
    let cleared = 0;
    for (const [id, l] of Object.entries(all)) {
      if (!l.sold && l.expiresAt < now) {
        l.sold = true; l.expiredAt = now;
        await saveListing(id, l);
        cleared++;
      }
    }
    res.json({ success:true, cleared });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.delete('/api/:guildId/tor/listing/:id', requireGuildAuth, async (req, res) => {
  try {
    const { getListing, saveListing } = torDb;
    const listing = getListing(req.params.id);
    if (!listing) return res.status(404).json({ error:'Not found.' });
    listing.sold = true; listing.removedByAdmin = true;
    await saveListing(req.params.id, listing);
    await writeAudit(req.guildId, req.session.user?.id, 'tor_remove', { id:req.params.id });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});


// ── ARTIST FAME GIVE/TAKE ─────────────────────────────────────
app.post('/api/:guildId/users/:id/artist-fame', requireGuildAuth, async (req, res) => {
  try {
    const { getPhone, savePhone, getArtistTier } = require('./utils/phoneDb');
    const phone = getPhone(req.params.id);
    if (!phone) return res.status(400).json({ error:'User has no phone.' });
    if (!phone.artistCareer) phone.artistCareer = { fame:0, tier:'unsigned', isPlant:false };
    if (req.body.setAbsolute) {
      phone.artistCareer.fame = Math.max(0, parseInt(req.body.delta)||0);
    } else {
      phone.artistCareer.fame = Math.max(0, (phone.artistCareer.fame||0) + (parseInt(req.body.delta)||0));
    }
    const newTier = getArtistTier(phone.artistCareer.fame);
    phone.artistCareer.tier = newTier.id;
    await savePhone(req.params.id, phone);
    await writeAudit(req.guildId, req.session.user?.id, 'artist_fame', { delta: req.body.delta, target: `<@${req.params.id}>`, newTier: newTier.label });
    res.json({ success:true, fame: phone.artistCareer.fame, tier: newTier.label });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── LAPTOP APP INSTALL (admin) ────────────────────────────────
app.post('/api/:guildId/users/:id/laptop-app', requireGuildAuth, async (req, res) => {
  try {
    const { getLaptop, saveLaptop, BUILTIN_APPS } = require('./utils/laptopDb');
    const appId = req.body.appId;
    if (!appId) return res.status(400).json({ error:'appId required.' });
    const laptop = getLaptop(req.params.id) || { userId:req.params.id, apps:[] };
    if (!laptop.apps) laptop.apps = [];
    if (laptop.apps.find(a => a.id === appId)) return res.status(400).json({ error:'App already installed.' });
    laptop.apps.push({ id:appId, quality:5, installedAt:Date.now(), adminInstalled:true });
    await saveLaptop(req.params.id, laptop);
    await writeAudit(req.guildId, req.session.user?.id, 'give_laptop_app', { appId, target: `<@${req.params.id}>` });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── HEAT GIVE/TAKE ────────────────────────────────────────────
app.post('/api/:guildId/users/:id/heat', requireGuildAuth, async (req, res) => {
  try {
    const { getOrCreateUser, saveUser } = db;
    const user  = getOrCreateUser(req.params.id);
    const delta = parseInt(req.body.delta)||0;
    user.heat   = Math.max(0, Math.min(100, (user.heat||0) + delta));
    saveUser(req.params.id, user);
    await writeAudit(req.guildId, req.session.user?.id, delta > 0 ? 'give_heat' : 'take_heat', { delta, target: `<@${req.params.id}>` });
    res.json({ success:true, heat: user.heat });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── GUILD ROLES ───────────────────────────────────────────────

// Resolve multiple user IDs to display names in one call
app.post('/api/:guildId/users/resolve', requireGuildAuth, async (req, res) => {
  try {
    const ids = req.body.ids || [];
    const result = {};

    // Try guild members first (gets nicknames)
    const members = await fetchAllMembers(req.guildId);
    const memberMap = {};
    if (Array.isArray(members)) {
      for (const m of members) {
        if (m.user) memberMap[m.user.id] = m.nick || m.user.global_name || m.user.username;
      }
    }

    // For IDs not in guild, fetch user directly — bot token can fetch any user
    const unknown = ids.filter(id => !memberMap[id]);
    await Promise.allSettled(unknown.map(async id => {
      try {
        const u = await fetchBotAPI(`/users/${id}`);
        if (u && (u.global_name || u.username)) {
          memberMap[id] = u.global_name || u.username;
        }
      } catch {}
    }));

    for (const id of ids) {
      // Only return if we got a real name, not a raw ID
      if (memberMap[id]) result[id] = memberMap[id];
    }
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/:guildId/guild/roles', requireGuildAuth, async (req, res) => {
  try {
    const roles = await fetchBotAPI(`/guilds/${req.guildId}/roles`);
    if (!roles) return res.status(500).json({ error: 'Failed to fetch roles' });
    res.json(roles.filter(r=>r.name!=='@everyone').sort((a,b)=>b.position-a.position).map(r=>({id:r.id,name:r.name,color:r.color})));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/:guildId/guild/channels', requireGuildAuth, async (req, res) => {
  try {
    const channels = await fetchBotAPI(`/guilds/${req.guildId}/channels`);
    if (!channels) return res.status(500).json({ error: 'Failed to fetch channels' });
    // Only text channels (type 0) and announcement channels (type 5)
    const textChannels = channels
      .filter(c => c.type === 0 || c.type === 5)
      .sort((a,b) => (a.position||0) - (b.position||0))
      .map(c => ({ id: c.id, name: c.name, type: c.type }));
    res.json(textChannels);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/users/:id/give-gang', requireGuildAuth, async (req, res) => {
  try {
    const { gangId } = req.body;
    if (!gangId) return res.status(400).json({ error: 'gangId required' });
    const { getAllGangs, saveGang, getGangByMember } = require('../utils/gangDb');
    if (getGangByMember(req.params.id)) return res.status(400).json({ error: 'User is already in a gang' });
    const all  = getAllGangs();
    const gang = all[gangId];
    if (!gang) return res.status(404).json({ error: 'Gang not found' });
    gang.members = gang.members || [];
    gang.members.push({ userId: req.params.id, role: 'Member', rep: 0, joinedAt: Date.now(), addedByDashboard: true });
    saveGang(gangId, gang);
    res.json({ success: true, gangName: gang.name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/users/:id/business-money', requireGuildAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ error: 'amount required' });
    const bizDb = require('../utils/bizDb');
    const biz   = bizDb.getBusiness(req.params.id);
    if (!biz) return res.status(404).json({ error: 'User does not own a business' });
    biz.revenue = (biz.revenue||0) + parseInt(amount);
    bizDb.saveBusiness(req.params.id, biz);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── EFFECTS ───────────────────────────────────────────────────

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

// ── LOTTERY ───────────────────────────────────────────────────

app.get('/api/:guildId/lottery', requireGuildAuth, async (req, res) => {
  try {
    const c   = await guildCol('lottery', req.guildId);
    const doc = await c.findOne({ _id: 'lottery' });
    const config = db.getConfig(req.guildId);
    res.json({ lottery: doc || {}, config: config.lottery || {} });
  } catch { res.json({ lottery:{}, config:{} }); }
});

app.post('/api/:guildId/lottery/settings', requireGuildAuth, (req, res) => {
  const { active, ticketPrice, intervalHours, minBonus, maxBonus, minPot } = req.body;
  const config = db.getConfig(req.guildId);
  if (!config.lottery) config.lottery = {};
  if (active        !== undefined) config.lottery.active        = active === 'true' || active === true;
  if (ticketPrice   !== undefined) config.lottery.ticketPrice   = parseInt(ticketPrice)||100;
  if (intervalHours !== undefined) config.lottery.intervalHours = parseFloat(intervalHours)||24;
  if (minBonus      !== undefined) config.lottery.minBonus      = parseInt(minBonus)||0;
  if (maxBonus      !== undefined) config.lottery.maxBonus      = parseInt(maxBonus)||0;
  if (minPot        !== undefined) config.lottery.minPot        = parseInt(minPot)||0;
  db.saveConfig(req.guildId, config);
  res.json({ success: true });
});

app.post('/api/:guildId/lottery/reset', requireGuildAuth, async (req, res) => {
  try {
    const c      = await guildCol('lottery', req.guildId);
    const config = db.getConfig(req.guildId);
    await c.updateOne({ _id:'lottery' }, { $set:{ pot:0, tickets:[], drawAt:Date.now()+(config.lottery?.intervalHours??24)*3600000 } }, { upsert:true });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/lottery/force-draw', requireGuildAuth, async (req, res) => {
  try {
    const c       = await guildCol('lottery', req.guildId);
    const lottery = await c.findOne({ _id:'lottery' });
    if (!lottery?.tickets?.length || !lottery.pot) return res.json({ success:true, result:null });
    const config = db.getConfig(req.guildId);
    const total  = lottery.tickets.reduce((s,t)=>s+t.count,0);
    let roll = Math.random()*total, winner = lottery.tickets[lottery.tickets.length-1];
    for (const t of lottery.tickets) { roll-=t.count; if(roll<=0){winner=t;break;} }
    const user = db.getOrCreateUser(winner.userId);
    user.wallet += lottery.pot; db.saveUser(winner.userId, user);
    const prize = lottery.pot;
    await c.updateOne({ _id:'lottery' }, { $set:{ pot:0, tickets:[], lastWinner:winner.userId, lastPot:prize, drawAt:Date.now()+(config.lottery?.intervalHours??24)*3600000 } });
    res.json({ success:true, result:{ winnerId:winner.userId, prize } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GANGS ─────────────────────────────────────────────────────

app.get('/api/:guildId/gangs', requireGuildAuth, async (req, res) => {
  try {
    const { getAllGangs, getAllWars } = require('../utils/gangDb');
    const gangs = Object.values(getAllGangs()).sort((a,b)=>(b.rep||0)-(a.rep||0));
    const wars  = Object.values(getAllWars()).filter(w=>w.endsAt>Date.now());
    res.json({ gangs, activeWars: wars });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/gangs/:id/delete', requireGuildAuth, async (req, res) => {
  try {
    const { getAllGangs } = require('../utils/gangDb');
    const all = getAllGangs();
    delete all[req.params.id];
    const fsp = require('fs'); const pathp = require('path');
    fsp.writeFileSync(pathp.join(__dirname,'../data/gangs.json'), JSON.stringify(all,null,2));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POLICE ────────────────────────────────────────────────────

app.get('/api/:guildId/police', requireGuildAuth, async (req, res) => {
  try {
    const { getAllHealth: gah } = require('../utils/gunDb');
    const fsp = require('fs'); const pathp = require('path');
    const pFile = pathp.join(__dirname,'../data/police.json');
    const police = fsp.existsSync(pFile) ? JSON.parse(fsp.readFileSync(pFile,'utf8')) : {};
    const list   = Object.entries(police).filter(([,r])=>(r.heat||0)>0||r.jailUntil).map(([userId,r])=>({userId,...r})).sort((a,b)=>(b.heat||0)-(a.heat||0));
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/police/:userId/release', requireGuildAuth, async (req, res) => {
  try {
    const fsp = require('fs'); const pathp = require('path');
    const pFile = pathp.join(__dirname,'../data/police.json');
    const police = fsp.existsSync(pFile) ? JSON.parse(fsp.readFileSync(pFile,'utf8')) : {};
    if (police[req.params.userId]) { police[req.params.userId].jailUntil = null; fsp.writeFileSync(pFile,JSON.stringify(police,null,2)); }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/police/:userId/clear', requireGuildAuth, async (req, res) => {
  try {
    const fsp = require('fs'); const pathp = require('path');
    const pFile = pathp.join(__dirname,'../data/police.json');
    const police = fsp.existsSync(pFile) ? JSON.parse(fsp.readFileSync(pFile,'utf8')) : {};
    police[req.params.userId] = { heat:0, arrests:0, jailUntil:null, offenses:[] };
    fsp.writeFileSync(pFile,JSON.stringify(police,null,2));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BUSINESSES ────────────────────────────────────────────────

app.get('/api/:guildId/businesses', requireGuildAuth, async (req, res) => {
  try {
    const bizDb = require('../utils/bizDb');
    const all   = bizDb.getAllBusinesses();
    res.json(Object.values(all).map(biz => {
      const type = bizDb.BIZ_TYPES[biz.type] || {};
      return { ...biz, typeName:type.name||biz.type, typeEmoji:type.emoji||'🏢', income:bizDb.calcIncome(biz), maxLevel:type.maxLevel||10 };
    }).sort((a,b)=>b.level-a.level));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AI ENTITIES ───────────────────────────────────────────────

app.get('/api/:guildId/ai-entities', requireGuildAuth, async (req, res) => {
  try {
    const { getAllEntities } = require('../utils/aiEntities');
    res.json(Object.values(getAllEntities()));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/:guildId/ai-entities/:id', requireGuildAuth, async (req, res) => {
  try {
    const { deleteEntity } = require('../utils/aiEntities');
    deleteEntity(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/ai-entities/:id/reset', requireGuildAuth, async (req, res) => {
  try {
    const { getEntity, saveEntity } = require('../utils/aiEntities');
    const entity = getEntity(req.params.id);
    if (!entity) return res.status(404).json({ error: 'Entity not found' });
    entity.mood = 'loyal'; entity.loyalty = 50;
    saveEntity(req.params.id, entity);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PETS ──────────────────────────────────────────────────────

app.get('/api/:guildId/pets', requireGuildAuth, async (req, res) => {
  try {
    const { getAllPets, PET_TYPES, calcPetStats } = require('../utils/petDb');
    const all  = getAllPets();
    const list = Object.values(all).map(p => {
      const type  = PET_TYPES[p.type] || {};
      const stats = calcPetStats(p);
      return { ...p, typeName:type.name, typeEmoji:type.emoji, rarity:type.rarity, tier:type.tier, stats };
    }).sort((a,b)=>(b.stats?.power||0)-(a.stats?.power||0));
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GUN SHOP ──────────────────────────────────────────────────

app.get('/api/:guildId/guns/shop', requireGuildAuth, async (req, res) => {
  try { const { getGunShop } = require('../utils/gunDb'); res.json(getGunShop()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/:guildId/guns/shop/:id', requireGuildAuth, async (req, res) => {
  try {
    const { getGunShop, saveGunShop } = require('../utils/gunDb');
    const shop = getGunShop();
    const idx  = shop.guns.findIndex(g=>g.id===req.params.id);
    if (idx===-1) return res.status(404).json({ error:'Gun not found' });
    shop.guns[idx] = { ...shop.guns[idx], ...req.body, id:req.params.id };
    saveGunShop(shop); res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/guns/shop', requireGuildAuth, async (req, res) => {
  try {
    const { getGunShop, saveGunShop } = require('../utils/gunDb');
    const shop = getGunShop();
    const gun  = { ...req.body, id:req.body.name?.toLowerCase().replace(/[^a-z0-9]+/g,'_')||`gun_${Date.now()}` };
    if (shop.guns.find(g=>g.id===gun.id)) return res.status(400).json({ error:'ID already exists' });
    shop.guns.push(gun); saveGunShop(shop); res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/:guildId/guns/shop/:id', requireGuildAuth, async (req, res) => {
  try {
    const { getGunShop, saveGunShop } = require('../utils/gunDb');
    const shop = getGunShop(); shop.guns = shop.guns.filter(g=>g.id!==req.params.id);
    saveGunShop(shop); res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/:guildId/guns/health', requireGuildAuth, async (req, res) => {
  try {
    const { getAllHealth, getStatus } = require('../utils/gunDb');
    const all  = getAllHealth() || {};
    const list = Object.entries(all).map(([userId,h]) => {
      try {
        return { userId, ...h, statusLabel: getStatus(h.hp ?? 100)?.label || 'Alive' };
      } catch { return { userId, ...h, statusLabel: 'Unknown' }; }
    }).filter(h => (h.hp ?? 100) < 100 || h.hospitalUntil);
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/guns/health/:userId/revive', requireGuildAuth, async (req, res) => {
  try {
    const { getHealth, saveHealth, MAX_HP } = require('../utils/gunDb');
    const h = getHealth(req.params.userId);
    h.hp = MAX_HP; h.status='alive'; h.hospitalUntil=null;
    saveHealth(req.params.userId, h); res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/businesses/:userId/delete', requireGuildAuth, async (req, res) => {
  try {
    const bizDb = require('../utils/bizDb');
    const bizListDel = bizDb.getBusinesses(req.params.userId);
    for (const b of bizListDel) await bizDb.deleteBusiness(req.params.userId, b.type);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Stock prices endpoint for dashboard live grid
app.get('/api/:guildId/stock-prices', requireGuildAuth, async (req, res) => {
  try {
    const { col } = require('../utils/mongo');
    const pc   = await col('stockPrices');
    const doc  = await pc.findOne({ _id: 'prices' });
    const prices = doc ? { ...doc } : {};
    delete prices._id;
    res.json({ prices });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CUSTOM COINS ─────────────────────────────────────────

app.get('/api/:guildId/coins', requireGuildAuth, async (req, res) => {
  try {
    const { col } = require('../utils/mongo');
    const c    = await col('customCoins');
    const docs = await c.find({}).toArray();
    res.json(docs.map(d => { const o={...d,id:d._id}; delete o._id; return o; }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/coins', requireGuildAuth, async (req, res) => {
  try {
    const { name, emoji, color, desc, volatility, tendency, startPrice, ownerId } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const id = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!id) return res.status(400).json({ error: 'Invalid coin name' });

    // Tendency -> drift/crash/moon values
    const TENDENCY_PRESETS = {
      balanced: { drift:0.001,  crashChance:0.05, moonChance:0.05, crashMag:0.50, moonMag:2.00 },
      moon:     { drift:0.008,  crashChance:0.02, moonChance:0.12, crashMag:0.30, moonMag:4.00 },
      rug:      { drift:-0.010, crashChance:0.12, moonChance:0.02, crashMag:0.80, moonMag:1.50 },
      stable:   { drift:0.002,  crashChance:0.02, moonChance:0.02, crashMag:0.25, moonMag:1.50 },
      volatile: { drift:0.000,  crashChance:0.08, moonChance:0.08, crashMag:0.65, moonMag:3.50 },
    };

    const VOL_MAP = { low:0.10, medium:0.25, high:0.40, extreme:0.55 };
    const preset  = TENDENCY_PRESETS[tendency] || TENDENCY_PRESETS.balanced;
    const vol     = VOL_MAP[volatility] || 0.25;

    const profile = {
      name, emoji: emoji||'🪙', color: color||'#f5c518', desc: desc||'A new memecoin.',
      vol, ...preset, floor: 0.001, custom: true, ownerId: ownerId||null,
      createdAt: Date.now(),
    };

    const { col } = require('../utils/mongo');
    const c = await col('customCoins');
    const existing = await c.findOne({ _id: id });
    if (existing) return res.status(400).json({ error: `Coin ${id} already exists` });

    await c.insertOne({ _id: id, ...profile });

    // Register with live tick engine
    try { const idx = require('../index'); if(idx.saveCustomCoin) await idx.saveCustomCoin(id, profile); } catch {}

    // Set starting price
    const pc = await col('stockPrices');
    const start = startPrice || (10 + Math.random() * 490);
    const pdoc  = await pc.findOne({ _id: 'prices' });
    const prices = pdoc ? { ...pdoc } : {};
    delete prices._id;
    prices[id] = start;
    await pc.replaceOne({ _id:'prices' }, { _id:'prices', ...prices }, { upsert:true });

    res.json({ success: true, id, profile });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/:guildId/coins/:id', requireGuildAuth, async (req, res) => {
  try {
    const { col } = require('../utils/mongo');
    const c = await col('customCoins');
    await c.deleteOne({ _id: req.params.id });
    try { const idx = require('../index'); if(idx.deleteCustomCoin) await idx.deleteCustomCoin(req.params.id); } catch {}
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Jail / prison config
app.post('/api/:guildId/config/jail', requireGuildAuth, (req, res) => {
  const config = db.getConfig(req.guildId);
  const { prisonRoleId, prisonChannelId, solitaryRoleId } = req.body;
  if (prisonRoleId    !== undefined) config.prisonRoleId    = prisonRoleId    || null;
  if (prisonChannelId !== undefined) config.prisonChannelId = prisonChannelId || null;
  if (solitaryRoleId  !== undefined) config.solitaryRoleId  = solitaryRoleId  || null;
  db.saveConfig(req.guildId, config);
  writeAudit(req.guildId, req.session.user?.id, 'jail_config', { prisonRoleId, prisonChannelId, solitaryRoleId });
  res.json({ success: true });
});

// ── INFLUENCER DASHBOARD ──────────────────────────────────────
app.get('/api/:guildId/influencers', requireGuildAuth, async (req, res) => {
  try {
    const { getAllPhones, getStatusTier, PHONE_TYPES } = require('../utils/phoneDb');
    const all     = getAllPhones();
    const members = await fetchAllMembers(req.guildId);
    const memberIds = new Set((members||[]).map(m => m.user?.id).filter(Boolean));

    const list = Object.entries(all)
      .filter(([id]) => memberIds.has(id))
      .map(([id, p]) => {
        const tier = getStatusTier(p.status||0);
        return {
          userId:      id,
          tier:        tier.label,
          tierId:      tier.id,
          status:      p.status||0,
          followers:   p.followers||0,
          hype:        p.hype||0,
          totalPosts:  p.totalPosts||0,
          totalEarned: p.totalEarned||0,
          activeDeals: (p.sponsorDeals||[]).filter(s=>s.active).length,
          shoutoutMult:p.coinShoutoutMult||1,
          streak:      p.streak||0,
        };
      })
      .sort((a,b) => b.status - a.status);

    res.json({ influencers: list });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/:guildId/sponsorships', requireGuildAuth, async (req, res) => {
  try {
    const { col } = require('../utils/mongo');
    const c    = await col('bizSponsorships');
    const docs = await c.find({}).toArray();
    const now  = Date.now();
    const deals = docs.flatMap(d =>
      (d.deals||[]).filter(s => s.expiresAt > now).map(s => ({
        ownerId:      d._id,
        influencerId: s.influencerId,
        boost:        s.boost,
        payout:       s.payout,
        expiresAt:    s.expiresAt,
      }))
    );
    res.json({ deals });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/config/shoutout-cooldown', requireGuildAuth, async (req, res) => {
  const config = db.getConfig(req.guildId);
  config.shoutoutCooldownMins = parseInt(req.body.value)||30;
  db.saveConfig(req.guildId, config);
  await writeAudit(req.guildId, req.session.user?.id, 'shoutout_cooldown', { value: config.shoutoutCooldownMins });
  res.json({ success: true });
});

app.post('/api/:guildId/config/promo-cooldown', requireGuildAuth, async (req, res) => {
  const config = db.getConfig(req.guildId);
  config.promoCooldownMins = parseInt(req.body.value)||60;
  db.saveConfig(req.guildId, config);
  await writeAudit(req.guildId, req.session.user?.id, 'promo_cooldown', { value: config.promoCooldownMins });
  res.json({ success: true });
});

app.post('/api/:guildId/config/hate-cooldown', requireGuildAuth, async (req, res) => {
  const config = db.getConfig(req.guildId);
  config.hateCooldownMins = parseInt(req.body.value)||60;
  db.saveConfig(req.guildId, config);
  await writeAudit(req.guildId, req.session.user?.id, 'hate_cooldown', { value: config.hateCooldownMins });
  res.json({ success: true });
});

app.post('/api/:guildId/users/:id/wipe-shoutout-cd', requireGuildAuth, async (req, res) => {
  try {
    const { getPhone, savePhone } = require('../utils/phoneDb');
    const phone = getPhone(req.params.id);
    if (!phone) return res.status(404).json({ error: 'No phone' });
    phone.lastShoutout = {};
    await savePhone(req.params.id, phone);
    await writeAudit(req.guildId, req.session.user?.id, 'wipe_shoutout_cd', { target: `<@${req.params.id}>` });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── POLICE SYSTEM ─────────────────────────────────────────────
app.post('/api/:guildId/config/police-role', requireGuildAuth, async (req, res) => {
  const config = db.getConfig(req.guildId);
  config.policeRoleId = req.body.roleId || null;
  db.saveConfig(req.guildId, config);
  res.json({ success: true });
});

app.post('/api/:guildId/config/home-prices', requireGuildAuth, async (req, res) => {
  const config = db.getConfig(req.guildId);
  config.homePrices     = req.body.prices  || {};
  config.breakInDefense = req.body.defense || {};
  db.saveConfig(req.guildId, config);
  await writeAudit(req.guildId, req.session.user?.id, 'home_prices', { prices: JSON.stringify(config.homePrices) });
  res.json({ success: true });
});

app.get('/api/:guildId/police/officers', requireGuildAuth, async (req, res) => {
  try {
    const { getOfficers, getTreasury } = require('../utils/policeDb');
    const officers = getOfficers(req.guildId);
    const treasury = getTreasury(req.guildId);
    res.json({ officers, treasury: treasury.balance || 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/police/fund-treasury', requireGuildAuth, async (req, res) => {
  try {
    const amount = parseInt(req.body.amount) || 0;
    if (amount < 1) return res.status(400).json({ error: 'Invalid amount' });
    const { fundTreasury } = require('../utils/policeDb');
    await fundTreasury(req.guildId, amount);
    await writeAudit(req.guildId, req.session.user?.id, 'fund_treasury', { amount });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/police/officer-salary', requireGuildAuth, async (req, res) => {
  try {
    const { userId, salary } = req.body;
    const { updateOfficer } = require('../utils/policeDb');
    await updateOfficer(req.guildId, userId, { salary: parseInt(salary)||0 });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/:guildId/police/officers/:userId', requireGuildAuth, async (req, res) => {
  try {
    const { fireOfficer } = require('../utils/policeDb');
    await fireOfficer(req.guildId, req.params.userId);
    await writeAudit(req.guildId, req.session.user?.id, 'fire_officer', { target: `<@${req.params.userId}>` });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/:guildId/config/narcotics-role', requireGuildAuth, async (req, res) => {
  const config = db.getConfig(req.guildId);
  config.narcoticsRoleId = req.body.roleId || null;
  db.saveConfig(req.guildId, config);
  res.json({ success: true });
});

// ── DRUG MARKET (Per-Guild) ───────────────────────────────────
app.get('/api/drugs', requireAuth, (req, res) => {
  const { getDrugs } = require('../utils/drugDb');
  const gid = req.query.guildId || req.session.guildId;
  res.json(getDrugs(gid));
});

app.post('/api/drugs', requireAuth, async (req, res) => {
  try {
    const { saveDrug } = require('../utils/drugDb');
    const gid = req.query.guildId || req.body.guildId || req.session.guildId;
    await saveDrug(req.body, gid);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/drugs/:id', requireAuth, async (req, res) => {
  try {
    const { saveDrug } = require('../utils/drugDb');
    const gid = req.query.guildId || req.body.guildId || req.session.guildId;
    await saveDrug({ ...req.body, id: req.params.id }, gid);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/drugs/:id', requireAuth, async (req, res) => {
  try {
    const { deleteDrug } = require('../utils/drugDb');
    const gid = req.query.guildId || req.session.guildId;
    await deleteDrug(req.params.id, gid);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── MONEY DROP CONFIG ─────────────────────────────────────────
app.post('/api/:guildId/config/money-drop', requireGuildAuth, async (req, res) => {
  const config = db.getConfig(req.guildId);
  const { enabled, channelId, minMins, maxMins } = req.body;
  if (enabled  !== undefined) config.moneyDropEnabled    = !!enabled;
  if (channelId !== undefined) config.moneyDropChannelId = channelId || null;
  if (minMins  !== undefined) config.moneyDropMinMins   = parseInt(minMins)||15;
  if (maxMins  !== undefined) config.moneyDropMaxMins   = parseInt(maxMins)||45;
  db.saveConfig(req.guildId, config);
  await writeAudit(req.guildId, req.session.user?.id, 'money_drop_config', { enabled: config.moneyDropEnabled });
  res.json({ success: true });
});

// ── EMBED TRIGGERS ────────────────────────────────────────────
app.post('/api/:guildId/embed-triggers', requireGuildAuth, async (req, res) => {
  try {
    const { event, channelId, embed, content } = req.body;
    if (!event || !channelId || !embed) return res.status(400).json({ error: 'event, channelId, embed required' });
    const config = db.getConfig(req.guildId);
    if (!config.embedTriggers) config.embedTriggers = {};
    config.embedTriggers[event] = { channelId, embed, content: content || null };
    db.saveConfig(req.guildId, config);
    await writeAudit(req.guildId, req.session.user?.id, 'embed_trigger_save', { event, channel: channelId });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/:guildId/embed-triggers/:event', requireGuildAuth, async (req, res) => {
  try {
    const config = db.getConfig(req.guildId);
    if (config.embedTriggers) delete config.embedTriggers[req.params.event];
    db.saveConfig(req.guildId, config);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SEND EMBED ────────────────────────────────────────────────
app.post('/api/:guildId/send-embed', requireGuildAuth, async (req, res) => {
  try {
    const { channelId, embed, ping } = req.body;
    if (!channelId || !embed) return res.status(400).json({ error: 'channelId and embed required' });

    const botClient = require('../index.client');
    if (!botClient) return res.status(503).json({ error: 'Bot not connected' });

    const channel = await botClient.channels.fetch(channelId).catch(() => null);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const { EmbedBuilder } = require('discord.js');
    const built = new EmbedBuilder();
    if (embed.color     !== undefined) built.setColor(embed.color);
    if (embed.title)                   built.setTitle(embed.title);
    if (embed.description)             built.setDescription(embed.description);
    if (embed.fields?.length)          built.addFields(embed.fields);
    if (embed.footer?.text)            built.setFooter({ text: embed.footer.text });
    if (embed.thumbnail?.url)          built.setThumbnail(embed.thumbnail.url);
    if (embed.image?.url)              built.setImage(embed.image.url);
    built.setTimestamp();

    await channel.send({
      content: ping ? '@everyone' : undefined,
      embeds:  [built],
      allowedMentions: ping ? { parse: ['everyone'] } : { parse: [] },
    });

    await writeAudit(req.guildId, req.session.user?.id, 'send_embed', {
      channel: channelId,
      title: embed.title || '(no title)',
    });

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AUDIT LOG ─────────────────────────────────────────────

async function writeAudit(guildId, userId, action, data={}) {
  try {
    const c = await col('auditLog');
    await c.insertOne({ guildId, userId, action, data, ts: Date.now() });
  } catch(e) { console.error('writeAudit error:', e.message); }
}

app.get('/api/:guildId/audit-log', requireGuildAuth, async (req, res) => {
  try {
    const c    = await col('auditLog');
    const logs = await c.find({ guildId: req.guildId }).sort({ ts: -1 }).limit(100).toArray();
    res.json(logs.map(l => ({ userId: l.userId, action: l.action, data: l.data, ts: l.ts })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BOT LEAVE ─────────────────────────────────────────────
app.post('/api/:guildId/leave', requireGuildAuth, async (req, res) => {
  try {
    await writeAudit(req.guildId, req.session.user?.id, 'bot_removed', {});
    // Correct endpoint: bot leaves a guild via DELETE /users/@me/guilds/:id
    // This requires using the bot client directly, not the REST API
    const botClient = require('../index.client');
    if (botClient) {
      const guild = botClient.guilds.cache.get(req.guildId);
      if (guild) await guild.leave();
    } else {
      // Fallback via REST
      await fetchBotAPI(`/users/@me/guilds/${req.guildId}`, 'DELETE');
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CATCH-ALL — redirect to login or serve dashboard ─────────

app.get('/', (req, res) => {
  if (req.session?.user) return res.redirect('/guild-select.html');
  res.redirect('/login.html');
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── PRELOAD CACHES ON STARTUP ────────────────────────────────
(async () => {
  try { await illuminatiDb.preloadIlluminatiCache(); console.log('[dashboard] illuminati cache ready'); } catch(e) { console.error('[dashboard] illuminati preload err:', e.message); }
  try {
    const creditDb2 = require('../utils/creditDb');
    if (creditDb2.preloadCreditCache) await creditDb2.preloadCreditCache();
    console.log('[dashboard] credit cache ready');
  } catch(e) { console.error('[dashboard] credit preload err:', e.message); }
  try {
    const torDb2 = require('../utils/torDb');
    if (torDb2.preloadTorCache) await torDb2.preloadTorCache();
    console.log('[dashboard] tor cache ready');
  } catch(e) { console.error('[dashboard] tor preload err:', e.message); }
})();

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🖥️  Dashboard running at http://0.0.0.0:${PORT}`);
  try {
    await require('../utils/db').preloadCache();
    await require('../utils/gunDb').preloadGunCache();
    await require('../utils/gangDb').preloadGangCache();
    await require('../utils/bizDb').preloadBizCache();
    await require('../utils/petDb').preloadPetCache();
    await require('../utils/phoneDb').preloadPhoneCache();
    await require('../utils/goonDb').preloadGoonCache();
    await require('../utils/bitcoinDb').preloadBitcoinCache();
    await require('../utils/drugDb').preloadDrugCache();
    console.log('📦 Dashboard caches loaded');
  } catch(e) { console.error('Dashboard cache preload error:', e.message); }
});
