// ============================================================
// utils/bizStockDb.js — Business Stock Exchange
// Prices stored in MongoDB; updated by tickBizStocks() in index.js
// Price drivers: level, earnings, income, activity, employees,
//                random noise, mean reversion, momentum, news shocks
// ============================================================
const { col } = require('./mongo');

let _prices    = {};  // bizId -> current price
let _history   = {};  // bizId -> [...last 100 prices]
let _sentiment = {};  // bizId -> { score: -1..1, expiresAt } from news/events

async function preloadBizStockCache() {
  try {
    const pc   = await col('bizStockPrices');
    const pdoc = await pc.findOne({ _id: 'prices' }).catch(() => null);
    if (pdoc) { const d = { ...pdoc }; delete d._id; _prices = d; }

    const hc   = await col('bizStockHistory');
    const hdoc = await hc.findOne({ _id: 'history' }).catch(() => null);
    if (hdoc) { const d = { ...hdoc }; delete d._id; _history = d; }

    console.log(`📊 Biz stock cache loaded (${Object.keys(_prices).length} stocks)`);
  } catch(e) { console.error('bizStockDb preload error:', e.message); }
}

function getBizStockPrice(bizId)   { return _prices[bizId] || null; }
function getBizStockHistory(bizId) { return (_history[bizId] || []).slice(-50); }
function getAllBizStockPrices()     { return { ..._prices }; }
function getAllBizStockHistory()    { return { ..._history }; }

// Inject a sentiment shock (e.g. from news feed, admin action, biz event)
// direction: 'bull' | 'bear'  strength: 0.1–1.0  durationMs: how long it lasts
function addBizSentiment(bizId, direction, strength, durationMs = 30 * 60 * 1000) {
  _sentiment[bizId] = {
    score:     direction === 'bull' ? Math.abs(strength) : -Math.abs(strength),
    expiresAt: Date.now() + durationMs,
  };
}

// Fundamental value based on multiple real business metrics
function calcFundamentalPrice(biz) {
  const { calcIncome } = require('./bizDb');
  const income = calcIncome(biz);

  // Activity score: 1.0 = collected in last hour, decays to 0 over 72h of inactivity
  const hoursSinceCollect = biz.lastCollect
    ? (Date.now() - biz.lastCollect) / 3600000
    : 48;
  const activity = Math.max(0, 1 - hoursSinceCollect / 72);

  // Employee score: 0–1 based on how staffed the business is (10 = full)
  const employeeScore = Math.min(1, ((biz.employees || []).length) / 10);

  // NPC quality bonus: NPC employees with high scores add value
  let npcBonus = 0;
  try {
    const { getNPC } = require('./npcEmployees');
    for (const emp of (biz.employees || [])) {
      if (!emp.isNPC) continue;
      const npc = getNPC(emp.npcId);
      if (npc) npcBonus += (npc.service + npc.management + npc.hustle) / 3;
    }
  } catch {}

  return Math.max(10,
    (biz.level || 1) * 200 +           // level is primary driver
    ((biz.totalEarned || 0) / 500) +    // lifetime earnings build long-term value
    income * 12 +                       // current income rate matters
    activity * 400 +                    // active businesses trade at a premium
    employeeScore * 250 +               // fully staffed = more valuable
    npcBonus * 8                        // quality staff bonus
  );
}

// Called by tickBizStocks each tick; returns updated momentum
function tickBizPrice(bizId, biz, momentum) {
  const current   = _prices[bizId] || calcFundamentalPrice(biz);
  const fundPrice = calcFundamentalPrice(biz);

  // Mean reversion — pulls price toward fundamental over time
  const meanReversion = ((fundPrice / current) - 1) * 0.02;

  // Random noise ±6% per tick
  const noise = (Math.random() - 0.5) * 0.12;

  // Momentum carries forward at 80%
  const mom = momentum * 0.8;

  // Sentiment shock from news/events
  let sentimentDrift = 0;
  const sent = _sentiment[bizId];
  if (sent) {
    if (Date.now() > sent.expiresAt) {
      delete _sentiment[bizId];
    } else {
      sentimentDrift = sent.score * 0.04; // 4% drift per tick while active
    }
  }

  // Random market event: 4% chance per tick (good or bad news)
  let eventShock = 0;
  if (Math.random() < 0.04) {
    const magnitude = 0.08 + Math.random() * 0.17; // 8–25% shock
    eventShock = (Math.random() > 0.5 ? 1 : -1) * magnitude;
  }

  // Activity penalty: if business hasn't collected in >48h, gradual bearish drift
  const hoursSince = biz.lastCollect ? (Date.now() - biz.lastCollect) / 3600000 : 0;
  const inactivityDrift = hoursSince > 48 ? -0.005 : 0;

  const totalMove = noise + meanReversion + mom + sentimentDrift + eventShock + inactivityDrift;
  const newMomentum = Math.max(-0.4, Math.min(0.4, momentum * 0.75 + (Math.random() - 0.5) * 0.03));

  const floor    = Math.max(1, fundPrice * 0.05);  // can crash to 5% of fair value
  const ceiling  = fundPrice * 10;                 // max 10x fair value
  const newPrice = Math.max(floor, Math.min(ceiling, current * (1 + totalMove)));

  _prices[bizId] = newPrice;
  if (!_history[bizId]) _history[bizId] = [];
  _history[bizId].push(Math.round(newPrice * 100) / 100);
  if (_history[bizId].length > 100) _history[bizId] = _history[bizId].slice(-100);

  return { newPrice, newMomentum };
}

// Initialise a business stock if not yet tracked
async function initBizStock(bizId, biz) {
  if (_prices[bizId]) return _prices[bizId];
  const price     = calcFundamentalPrice(biz);
  _prices[bizId]  = price;
  _history[bizId] = [price];
  await saveBizStockState();
  return price;
}

async function saveBizStockState() {
  try {
    const pc = await col('bizStockPrices');
    await pc.replaceOne({ _id:'prices' }, { _id:'prices', ..._prices }, { upsert:true });
    const hc = await col('bizStockHistory');
    await hc.replaceOne({ _id:'history' }, { _id:'history', ..._history }, { upsert:true });
  } catch(e) { console.error('bizStock save error:', e.message); }
}

module.exports = {
  preloadBizStockCache,
  getBizStockPrice, getBizStockHistory,
  getAllBizStockPrices, getAllBizStockHistory,
  calcFundamentalPrice, initBizStock,
  tickBizPrice, saveBizStockState,
  addBizSentiment,
};
