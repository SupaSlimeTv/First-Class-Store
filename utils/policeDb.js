// ============================================================
// utils/policeDb.js — Police System Database
// Warrants, officers, credibility, bribes
// ============================================================
const { col } = require('./mongo');

let _warrants    = {}; // guildId -> [{ id, targetId, reason, issuedBy, issuedAt, expiresAt, type }]
let _officers    = {}; // guildId -> [{ userId, salary, hiredAt, credibility, bribesAccepted }]
let _treasury    = {}; // guildId -> { balance }

const WARRANT_DURATION = 2 * 60 * 60 * 1000; // 2 hours
const HEAT_WARRANT_THRESHOLD = 25;

async function preloadPoliceCache() {
  try {
    const c    = await col('policeData');
    const docs = await c.find({}).toArray();
    for (const d of docs) {
      if (d.type === 'warrants')  _warrants[d.guildId]  = d.data || [];
      if (d.type === 'officers')  _officers[d.guildId]  = d.data || [];
      if (d.type === 'treasury')  _treasury[d.guildId]  = d.data || { balance: 0 };
    }
    console.log(`🚔 Police cache loaded`);
  } catch(e) { console.error('preloadPoliceCache error:', e.message); }
}

async function savePoliceData(guildId, type, data) {
  const key = `${guildId}:${type}`;
  try {
    const c = await col('policeData');
    await c.replaceOne({ _id: key }, { _id: key, guildId, type, data }, { upsert: true });
  } catch(e) { console.error('savePoliceData error:', e.message); }
}

// ── WARRANTS ──────────────────────────────────────────────────
function getWarrants(guildId) {
  const now = Date.now();
  _warrants[guildId] = (_warrants[guildId] || []).filter(w => w.expiresAt > now);
  return _warrants[guildId];
}

function hasActiveWarrant(guildId, userId) {
  return getWarrants(guildId).some(w => w.targetId === userId);
}

async function issueWarrant(guildId, targetId, issuedBy, reason, type = 'manual') {
  if (!_warrants[guildId]) _warrants[guildId] = [];
  // Remove existing warrant for same target
  _warrants[guildId] = _warrants[guildId].filter(w => w.targetId !== targetId);
  const warrant = {
    id:       `${Date.now()}_${targetId}`,
    targetId, issuedBy, reason, type,
    issuedAt:  Date.now(),
    expiresAt: Date.now() + WARRANT_DURATION,
  };
  _warrants[guildId].push(warrant);
  await savePoliceData(guildId, 'warrants', _warrants[guildId]);
  return warrant;
}

async function clearWarrant(guildId, targetId) {
  _warrants[guildId] = (_warrants[guildId] || []).filter(w => w.targetId !== targetId);
  await savePoliceData(guildId, 'warrants', _warrants[guildId]);
}

// Auto-issue warrant if heat >= threshold
async function checkHeatWarrant(guildId, userId, heat) {
  if (heat >= HEAT_WARRANT_THRESHOLD && !hasActiveWarrant(guildId, userId)) {
    await issueWarrant(guildId, userId, 'SYSTEM', `Heat level reached ${heat}`, 'auto');
    return true;
  }
  return false;
}

// ── OFFICERS ──────────────────────────────────────────────────
function getOfficers(guildId)   { return _officers[guildId] || []; }
function isOfficer(guildId, userId) { return getOfficers(guildId).some(o => o.userId === userId); }

async function hireOfficer(guildId, userId, salary = 0) {
  if (!_officers[guildId]) _officers[guildId] = [];
  if (isOfficer(guildId, userId)) return false;
  _officers[guildId].push({ userId, salary, hiredAt: Date.now(), credibility: 100, bribesAccepted: 0, searchCooldowns: {} });
  await savePoliceData(guildId, 'officers', _officers[guildId]);
  return true;
}

async function fireOfficer(guildId, userId) {
  _officers[guildId] = (_officers[guildId] || []).filter(o => o.userId !== userId);
  await savePoliceData(guildId, 'officers', _officers[guildId]);
}

async function updateOfficer(guildId, userId, updates) {
  const officers = _officers[guildId] || [];
  const idx = officers.findIndex(o => o.userId === userId);
  if (idx === -1) return;
  _officers[guildId][idx] = { ..._officers[guildId][idx], ...updates };
  await savePoliceData(guildId, 'officers', _officers[guildId]);
}

function getOfficer(guildId, userId) {
  return (_officers[guildId] || []).find(o => o.userId === userId) || null;
}

// ── TREASURY ──────────────────────────────────────────────────
function getTreasury(guildId)   { return _treasury[guildId] || { balance: 0 }; }

async function fundTreasury(guildId, amount) {
  if (!_treasury[guildId]) _treasury[guildId] = { balance: 0 };
  _treasury[guildId].balance = Math.max(0, (_treasury[guildId].balance || 0) + amount);
  await savePoliceData(guildId, 'treasury', _treasury[guildId]);
}

async function deductTreasury(guildId, amount) {
  if (!_treasury[guildId]) _treasury[guildId] = { balance: 0 };
  const available = Math.min(_treasury[guildId].balance || 0, amount);
  _treasury[guildId].balance = Math.max(0, (_treasury[guildId].balance || 0) - available);
  await savePoliceData(guildId, 'treasury', _treasury[guildId]);
  return available;
}

module.exports = {
  preloadPoliceCache,
  getWarrants, hasActiveWarrant, issueWarrant, clearWarrant, checkHeatWarrant,
  getOfficers, isOfficer, hireOfficer, fireOfficer, updateOfficer, getOfficer,
  getTreasury, fundTreasury, deductTreasury,
  WARRANT_DURATION, HEAT_WARRANT_THRESHOLD,
};
