// ============================================================
// utils/illuminatiDb.js — Illuminati System
// Per-server organization, but rank carries cross-server
// ============================================================
const { col } = require('./mongo');

let _illuminati = {}; // guildId -> { members:[], vault:0, operations:[], tribute:{} }
let _evidence   = {}; // guildId -> { userId -> witnessCount }

const MAX_MEMBERS    = 13;
const INITIATION_FEE = 250000;
const EXPOSE_THRESHOLD = 3; // witness 3 ops to expose

const RANKS = {
  initiate:    { label:'🔺 Initiate',    level:1 },
  operative:   { label:'👁️ Operative',   level:2 },
  elder:       { label:'💎 Elder',        level:3 },
  grandmaster: { label:'⚡ Grandmaster', level:4 },
};

const ELIGIBILITY = {
  minWallet:   500000,
  minStatus:   50,
  minBizLevel: 5,
  homeTier:    'estate',
};

async function preloadIlluminatiCache() {
  try {
    const c    = await col('illuminati');
    const docs = await c.find({}).toArray();
    for (const d of docs) {
      const id = d._id; const o = {...d}; delete o._id;
      if (id.startsWith('evidence:')) _evidence[id.replace('evidence:','')] = o;
      else _illuminati[id] = o;
    }
    console.log(`🔺 Illuminati cache loaded (${Object.keys(_illuminati).length} servers)`);
  } catch(e) { console.error('preloadIlluminatiCache error:', e.message); }
}

function getIlluminati(guildId) {
  return _illuminati[guildId] || null;
}

function getOrCreateIlluminati(guildId) {
  if (!_illuminati[guildId]) _illuminati[guildId] = {
    members: [], vault: 0, operations: [],
    tribute: {}, protectedGangs: {}, exposed: false,
    createdAt: Date.now(),
  };
  return _illuminati[guildId];
}

async function saveIlluminati(guildId, data) {
  _illuminati[guildId] = data;
  try {
    const c = await col('illuminati');
    await c.replaceOne({ _id: guildId }, { _id: guildId, ...data }, { upsert: true });
  } catch(e) { console.error('saveIlluminati error:', e.message); }
}

function getMember(guildId, userId) {
  return (getIlluminati(guildId)?.members||[]).find(m => m.userId === userId) || null;
}

function isMember(guildId, userId) {
  return !!(getIlluminati(guildId)?.members||[]).find(m => m.userId === userId);
}

function isGrandmaster(guildId, userId) {
  return getMember(guildId, userId)?.rank === 'grandmaster';
}

function isElder(guildId, userId) {
  const rank = getMember(guildId, userId)?.rank;
  return rank === 'elder' || rank === 'grandmaster';
}

// Evidence system
function getEvidence(guildId) {
  return _evidence[guildId] || {};
}

async function addEvidence(guildId, witnessId) {
  if (!_evidence[guildId]) _evidence[guildId] = {};
  _evidence[guildId][witnessId] = (_evidence[guildId][witnessId] || 0) + 1;
  try {
    const c = await col('illuminati');
    await c.replaceOne({ _id:`evidence:${guildId}` }, { _id:`evidence:${guildId}`, ..._evidence[guildId] }, { upsert:true });
  } catch(e) {}
  return _evidence[guildId][witnessId];
}

async function clearEvidence(guildId) {
  _evidence[guildId] = {};
  try {
    const c = await col('illuminati');
    await c.deleteOne({ _id:`evidence:${guildId}` });
  } catch(e) {}
}

// Check eligibility
async function checkEligibility(userId, guildId) {
  const issues = [];
  try {
    const { getUser } = require('./db');
    const { getHome }  = require('./homeDb');
    const { getPhone } = require('./phoneDb');
    const { getBusiness } = require('./bizDb');

    const user = getUser(userId);
    if (!user) { issues.push('No account'); return issues; }

    const wealth = (user.wallet||0) + (user.bank||0);
    if (wealth < ELIGIBILITY.minWallet) issues.push(`Need $${ELIGIBILITY.minWallet.toLocaleString()} total wealth (have $${wealth.toLocaleString()})`);

    const phone = getPhone(userId);
    if (!phone || (phone.status||0) < ELIGIBILITY.minStatus) issues.push(`Need ${ELIGIBILITY.minStatus}+ status (have ${phone?.status||0})`);

    const biz = getBusiness(userId);
    if (!biz || (biz.level||1) < ELIGIBILITY.minBizLevel) issues.push(`Need business level ${ELIGIBILITY.minBizLevel}+ (have level ${biz?.level||0})`);

    const home = getHome(userId);
    if (!home || home.tier !== ELIGIBILITY.homeTier) issues.push(`Need an Estate (🏰) — currently ${home?.tier||'no home'}`);

  } catch(e) { issues.push('Error checking eligibility'); }
  return issues;
}

module.exports = {
  preloadIlluminatiCache,
  getIlluminati, getOrCreateIlluminati, saveIlluminati,
  getMember, isMember, isGrandmaster, isElder,
  getEvidence, addEvidence, clearEvidence, checkEligibility,
  RANKS, MAX_MEMBERS, INITIATION_FEE, EXPOSE_THRESHOLD, ELIGIBILITY,
};
