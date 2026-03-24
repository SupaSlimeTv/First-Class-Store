// ============================================================
// utils/creditDb.js — Credit Cards, SSN, Identity System
// ============================================================
const { col } = require('./mongo');

let _credit = {}; // userId -> creditProfile

// ── CREDIT SCORE TIERS ────────────────────────────────────────
const CREDIT_TIERS = [
  { min:800, max:850, label:'💎 Excellent', card:'Black Card',   interestDay:0.05, limitPct:0.50, color:0xf5c518 },
  { min:740, max:799, label:'🟢 Very Good', card:'Platinum Card',interestDay:0.08, limitPct:0.40, color:0x2ecc71 },
  { min:670, max:739, label:'🟡 Good',      card:'Gold Card',    interestDay:0.10, limitPct:0.30, color:0xf5c518 },
  { min:580, max:669, label:'🟠 Fair',      card:'Standard Card',interestDay:0.15, limitPct:0.20, color:0xe67e22 },
  { min:300, max:579, label:'🔴 Poor',      card:null,           interestDay:0.20, limitPct:0.00, color:0xe74c3c },
];

function getCreditTier(score) {
  return CREDIT_TIERS.find(t => score >= t.min && score <= t.max) || CREDIT_TIERS[4];
}

// ── SSN GENERATOR ─────────────────────────────────────────────
function generateSSN() {
  const r = () => Math.floor(Math.random() * 900) + 100;
  const r2= () => String(Math.floor(Math.random() * 90) + 10);
  const r4= () => String(Math.floor(Math.random() * 9000) + 1000);
  return `${r()}-${r2()}-${r4()}`;
}

// ── CACHE LOAD/SAVE ───────────────────────────────────────────
async function preloadCreditCache() {
  try {
    const c    = await col('credit');
    const docs = await c.find({}).toArray();
    for (const d of docs) {
      const id = d._id; const o = {...d}; delete o._id;
      _credit[id] = o;
    }
    console.log(`💳 Credit cache loaded (${Object.keys(_credit).length} profiles)`);
  } catch(e) { console.error('preloadCreditCache error:', e.message); }
}

function getCredit(userId) { return _credit[userId] || null; }

async function saveCredit(userId, data) {
  _credit[userId] = data;
  try {
    const c = await col('credit');
    await c.replaceOne({ _id:userId }, { _id:userId, ...data }, { upsert:true });
  } catch(e) { console.error('saveCredit error:', e.message); }
}

async function getOrCreateCredit(userId) {
  if (_credit[userId]) return _credit[userId];
  const profile = {
    ssn:         generateSSN(),
    score:       680, // start Good
    card:        null,
    balance:     0,    // current card balance
    limit:       0,
    lastBilling: null,
    payments:    0,    // on-time payments
    missed:      0,    // missed payments
    frozen:      false,
    stolenBy:    [],   // userIds who have stolen SSN
    ssnFragments:{},   // userId -> fragments stolen
    loans:       [],   // active business loans
    history:     [],   // recent activity
    createdAt:   Date.now(),
  };
  await saveCredit(userId, profile);
  return profile;
}

function getAllCredit() { return { ..._credit }; }

// Score adjustment
async function adjustScore(userId, delta, reason) {
  const p = await getOrCreateCredit(userId);
  p.score = Math.max(300, Math.min(850, (p.score||680) + delta));
  p.history = [...(p.history||[]).slice(-19), { delta, reason, at:Date.now(), score:p.score }];
  await saveCredit(userId, p);
  return p.score;
}

// Loan helpers
function calcLoanPayment(principal, termDays) {
  const daily = 0.001; // 0.1% daily interest
  return Math.ceil(principal * (1 + daily * termDays) / termDays);
}

module.exports = {
  preloadCreditCache, getCredit, getOrCreateCredit, saveCredit, getAllCredit,
  adjustScore, getCreditTier, generateSSN, calcLoanPayment,
  CREDIT_TIERS,
};
