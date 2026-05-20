// ============================================================
// utils/bizStockDb.js — Business Stock Exchange
// Prices stored in MongoDB; updated by tickBizStocks() in index.js
// ============================================================
const { col } = require('./mongo');

let _prices  = {};  // bizId -> current price
let _history = {};  // bizId -> [...last 100 prices]

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

// Fundamental value based on business metrics
function calcFundamentalPrice(biz) {
  const { calcIncome } = require('./bizDb');
  const income = calcIncome(biz);
  return Math.max(10, (biz.level || 1) * 100 + ((biz.totalEarned || 0) / 1000) + income * 5);
}

// Initialise a business stock if not yet tracked
async function initBizStock(bizId, biz) {
  if (_prices[bizId]) return _prices[bizId];
  const price      = calcFundamentalPrice(biz);
  _prices[bizId]   = price;
  _history[bizId]  = [price];
  await saveBizStockState();
  return price;
}

// Called by tickBizStocks each tick; returns updated momentum
function tickBizPrice(bizId, biz, momentum) {
  const current   = _prices[bizId] || calcFundamentalPrice(biz);
  const fundPrice = calcFundamentalPrice(biz);

  const meanReversion = ((fundPrice / current) - 1) * 0.015;
  const noise         = (Math.random() - 0.5) * 0.08;
  const mom           = momentum * 0.7;

  const newMomentum = Math.max(-0.3, Math.min(0.3, momentum * 0.8 + (Math.random() - 0.5) * 0.02));
  const floor       = Math.max(1, fundPrice * 0.1);
  const ceiling     = fundPrice * 8;
  const newPrice    = Math.max(floor, Math.min(ceiling, current * (1 + noise + meanReversion + mom)));

  _prices[bizId] = newPrice;
  if (!_history[bizId]) _history[bizId] = [];
  _history[bizId].push(Math.round(newPrice * 100) / 100);
  if (_history[bizId].length > 100) _history[bizId] = _history[bizId].slice(-100);

  return { newPrice, newMomentum };
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
};
