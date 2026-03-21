// ============================================================
// utils/bitcoinDb.js — Bitcoin Mixer / Money Washing
// Converts hot stolen money to clean untraceable funds
// ============================================================
const { col } = require('./mongo');

let _btc = {};

async function preloadBitcoinCache() {
  try {
    const c    = await col('bitcoin');
    const docs = await c.find({}).toArray();
    _btc = Object.fromEntries(docs.map(d => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    console.log(`₿ Bitcoin cache loaded (${Object.keys(_btc).length} wallets)`);
  } catch(e) { console.error('preloadBitcoinCache error:', e.message); }
}

function getBtcWallet(userId)  { return _btc[userId] || { hotFunds:0, cleanFunds:0, mixQueue:[], investigations:[] }; }
function getAllBtcWallets()     { return { ..._btc }; }

async function saveBtcWallet(userId, data) {
  _btc[userId] = data;
  try {
    const c = await col('bitcoin');
    await c.replaceOne({ _id: userId }, { _id: userId, ...data }, { upsert: true });
  } catch(e) { console.error('saveBtcWallet error:', e.message); }
}

// BTC mixer fee tiers — faster = more expensive
const MIXER_TIERS = {
  slow:   { name:'Slow Mix',   emoji:'🐢', hours:4,  fee:0.05, detectChance:0.10, desc:'4 hour delay, 5% fee, low heat' },
  normal: { name:'Normal Mix', emoji:'⚡', hours:1,  fee:0.10, detectChance:0.20, desc:'1 hour delay, 10% fee' },
  fast:   { name:'Fast Mix',   emoji:'🚀', hours:0,  fee:0.20, detectChance:0.40, desc:'Instant, 20% fee, higher detection risk' },
};

module.exports = { preloadBitcoinCache, getBtcWallet, saveBtcWallet, getAllBtcWallets, MIXER_TIERS };
