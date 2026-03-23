// ============================================================
// utils/gangDb.js — Gang Database (MongoDB)
// ============================================================
const { col } = require('./mongo');

// ── In-memory caches ──────────────────────────────────────
let _gangs  = {};
let _police = {};
let _wars   = {};

async function preloadGangCache() {
  try {
    const [gc, pc, wc] = await Promise.all([col('gangs'), col('police'), col('gangWars')]);
    const [gangs, police, wars] = await Promise.all([gc.find({}).toArray(), pc.find({}).toArray(), wc.find({}).toArray()]);
    _gangs  = Object.fromEntries(gangs.map(d  => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    _police = Object.fromEntries(police.map(d => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    _wars   = Object.fromEntries(wars.map(d   => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    console.log(`📦 Gang cache loaded (${Object.keys(_gangs).length} gangs)`);
  } catch(e) { console.error('preloadGangCache error:', e.message); }
}

// ── GANGS ─────────────────────────────────────────────────
function getGang(gangId)         { return _gangs[gangId] || null; }
function getGangByMember(userId) { return Object.values(_gangs).find(g => (g.members||[]).some(m => m.userId === userId)) || null; }
function getAllGangs()            { return { ..._gangs }; }
function getAllWars()             { return { ..._wars }; }

async function saveGang(gangId, data) {
  _gangs[gangId] = data;
  try { const c = await col('gangs');  await c.replaceOne({ _id: gangId }, { _id: gangId, ...data }, { upsert: true }); }
  catch(e) { console.error('saveGang error:', e.message); }
}

async function deleteGang(gangId) {
  delete _gangs[gangId];
  try { const c = await col('gangs'); await c.deleteOne({ _id: gangId }); }
  catch(e) { console.error('deleteGang error:', e.message); }
}

// ── POLICE ────────────────────────────────────────────────
function getPoliceRecord(userId) {
  return _police[userId] || { userId, heat: 0, arrests: 0, jailUntil: null, offenses: [] };
}

function getAllPoliceRecords() { return { ..._police }; }

async function savePoliceRecord(userId, data) {
  _police[userId] = data;
  try { const c = await col('police'); await c.replaceOne({ _id: userId }, { _id: userId, ...data }, { upsert: true }); }
  catch(e) { console.error('savePoliceRecord error:', e.message); }
}

// ── WARS ──────────────────────────────────────────────────
function getWar(warId)  { return _wars[warId] || null; }

async function saveWar(warId, data) {
  _wars[warId] = data;
  try { const c = await col('gangWars'); await c.replaceOne({ _id: warId }, { _id: warId, ...data }, { upsert: true }); }
  catch(e) { console.error('saveWar error:', e.message); }
}

async function deleteWar(warId) {
  delete _wars[warId];
  try { const c = await col('gangWars'); await c.deleteOne({ _id: warId }); }
  catch(e) { console.error('deleteWar error:', e.message); }
}

// ── HELPERS ───────────────────────────────────────────────
function isJailed(userId) {
  const r = getPoliceRecord(userId);
  if (!r.jailUntil) return false;
  if (Date.now() > r.jailUntil) { r.jailUntil = null; savePoliceRecord(userId, r); return false; }
  return true;
}

function getJailTimeLeft(userId) {
  const r = getPoliceRecord(userId);
  if (!r.jailUntil) return 0;
  return Math.max(0, Math.ceil((r.jailUntil - Date.now()) / 60000));
}

async function addHeat(userId, amount, reason) {
  const r  = getPoliceRecord(userId);
  r.heat   = Math.min(100, (r.heat || 0) + amount);
  r.offenses = r.offenses || [];
  r.offenses.push({ reason, amount, at: Date.now() });
  await savePoliceRecord(userId, r);

  // Auto-issue warrant if heat crosses threshold — runs silently in background
  try {
    const { checkHeatWarrant } = require('./policeDb');
    // We need a guildId — check all guilds this user might be in via bot client
    // Since gangDb doesn't have guild context, we fire a global event for index.js to handle
    if (typeof global._checkHeatWarrant === 'function') {
      global._checkHeatWarrant(userId, r.heat);
    }
  } catch {}

  return r.heat;
}

async function checkPoliceRaid(userId, client, channelId) {
  const r = getPoliceRecord(userId);
  if ((r.heat || 0) < 60) return null;
  const raidChance = (r.heat - 60) / 200;
  if (Math.random() > raidChance) return null;
  const { getOrCreateUser, saveUser, getConfig } = require('./db');
  const user    = getOrCreateUser(userId);
  const fine    = Math.floor(user.wallet * 0.25);
  user.wallet   = Math.max(0, user.wallet - fine);
  const jailMinutes = 10;
  r.jailUntil   = Date.now() + jailMinutes * 60 * 1000;
  r.arrests     = (r.arrests || 0) + 1;
  r.heat        = Math.max(0, r.heat - 30);
  r.jailReason  = 'Police raid — too much heat';
  saveUser(userId, user);
  await savePoliceRecord(userId, r);

  // Apply Discord jail role if prison is set up
  if (client) {
    try {
      for (const [, guild] of client.guilds.cache) {
        const config = getConfig(guild.id);
        if (!config.prisonRoleId || !config.prisonChannelId) continue;
        const { jailUser } = require('../commands/moderation/jail');
        await jailUser(guild, userId, jailMinutes, 'Police raid — heat level too high', config, null);
      }
    } catch(e) { console.error('checkPoliceRaid jail error:', e.message); }
  }

  return { fine, jailMinutes };
}

// ── GANG RANKS ────────────────────────────────────────────
const GANG_RANKS = [
  { name: 'Prospect',    minRep: 0    },
  { name: 'Soldier',     minRep: 100  },
  { name: 'Associate',   minRep: 300  },
  { name: 'Capo',        minRep: 700  },
  { name: 'Underboss',   minRep: 1500 },
  { name: 'Consigliere', minRep: 3000 },
];

function getMemberRank(rep) {
  return [...GANG_RANKS].reverse().find(r => rep >= r.minRep) || GANG_RANKS[0];
}

module.exports = {
  preloadGangCache,
  getGang, getGangByMember, getAllGangs, saveGang, deleteGang,
  getPoliceRecord, savePoliceRecord,
  getWar, getAllWars, saveWar, deleteWar,
  addHeat, checkPoliceRaid, isJailed, getJailTimeLeft, getAllPoliceRecords,
  GANG_RANKS, getMemberRank,
};
