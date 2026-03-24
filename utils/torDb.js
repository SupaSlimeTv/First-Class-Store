// ============================================================
// utils/torDb.js — Dark Web / TOR System
// Users can buy/sell stolen data. Traceable if sloppy.
// ============================================================
const { col } = require('./mongo');

let _listings = {}; // listingId -> listing
let _torUsers  = {}; // userId -> { handle, karma, sales, buys, jailed }

const TOR_HEAT_ON_BUY  = 25;  // heat added for buying
const TOR_HEAT_ON_SELL = 15;  // heat added for selling
const TOR_TRACE_CHANCE = 0.30; // 30% base chance of being traced
const TOR_VPN_REDUCTION= 0.60; // VPN reduces trace by 60%
const TOR_ILLUM_EXEMPT = true; // Illuminati members never traced

async function preloadTorCache() {
  try {
    const [lc, uc] = await Promise.all([col('torListings'), col('torUsers')]);
    const [listings, users] = await Promise.all([lc.find({}).toArray(), uc.find({}).toArray()]);
    for (const d of listings) { const id=d._id; const o={...d}; delete o._id; _listings[id]=o; }
    for (const d of users)    { const id=d._id; const o={...d}; delete o._id; _torUsers[id]=o; }
    console.log(`🌐 TOR cache loaded (${Object.keys(_listings).length} listings)`);
  } catch(e) { console.error('preloadTorCache error:', e.message); }
}

function getListing(id)   { return _listings[id] || null; }
function getAllListings()  { return { ..._listings }; }
function getActiveListings() {
  const now = Date.now();
  return Object.entries(_listings)
    .filter(([,l]) => !l.sold && l.expiresAt > now)
    .map(([id,l]) => ({ id, ...l }))
    .sort((a,b) => (b.price||0) - (a.price||0)); // most expensive first
}

// Calculate dynamic price for a victim's SSN based on their wealth
function calcSsnPrice(userId) {
  try {
    const { getUser } = require('./db');
    const u = getUser(userId);
    if (!u) return 1000;
    const wealth = (u.wallet||0) + (u.bank||0);
    // Base $500, +1% of total wealth, capped at $250k
    return Math.max(500, Math.min(250000, Math.floor(500 + wealth * 0.01)));
  } catch { return 1000; }
}

// Create a random data leak listing — includes SSN + routing number if available
async function createDataLeak(userId, victimData) {
  const price = calcSsnPrice(userId);
  const listingId = 'LEAK' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random()*100);

  // Try to pull business routing number
  let routingNumber = null;
  try {
    const { col: _col } = require('./mongo');
    const rc  = await _col('routingNumbers');
    const doc = await rc.findOne({ _id: userId });
    if (doc?.routing) routingNumber = doc.routing;
  } catch {}

  // Try to pull business name
  let bizName = null;
  try {
    const { getBusiness } = require('./bizDb');
    const biz = getBusiness(userId);
    if (biz) bizName = biz.name;
  } catch {}

  const hasBusinessData = !!(routingNumber || bizName);
  const typeName = hasBusinessData
    ? 'Full Identity + Business Routing (Data Breach)'
    : 'Full SSN + Credit Profile (Data Breach)';

  const listing = {
    id:           listingId,
    sellerId:     'data_leak',
    sellerHandle: 'DataLeakBot',
    victimId:     userId,
    type:         hasBusinessData ? 'full_identity' : 'full_ssn',
    typeName,
    quality:      3,
    price:        hasBusinessData ? Math.floor(price * 1.5) : price, // business data worth more
    data: {
      ...victimData,
      ...(routingNumber ? { routingNumber } : {}),
      ...(bizName       ? { bizName }       : {}),
    },
    createdAt:    Date.now(),
    expiresAt:    Date.now() + 48 * 60 * 60 * 1000,
    sold:         false,
    isLeak:       true,
    hasBusinessData,
  };
  await saveListing(listingId, listing);
  return listing;
}

function getTorUser(userId) { return _torUsers[userId] || null; }

async function saveListing(id, data) {
  _listings[id] = data;
  try { const c=await col('torListings'); await c.replaceOne({_id:id},{_id:id,...data},{upsert:true}); } catch(e){}
}

async function saveTorUser(userId, data) {
  _torUsers[userId] = data;
  try { const c=await col('torUsers'); await c.replaceOne({_id:userId},{_id:userId,...data},{upsert:true}); } catch(e){}
}

async function getOrCreateTorUser(userId) {
  if (_torUsers[userId]) return _torUsers[userId];
  const handle = generateHandle();
  const u = { handle, karma:0, sales:0, buys:0, joinedAt:Date.now() };
  await saveTorUser(userId, u);
  return u;
}

function generateHandle() {
  const adj = ['Shadow','Dark','Ghost','Cipher','Hex','Binary','Null','Void','Anon','Phantom'];
  const noun= ['Wolf','Fox','Hawk','Node','Byte','Zero','Gate','Key','Proxy','Glitch'];
  return adj[Math.floor(Math.random()*adj.length)] + noun[Math.floor(Math.random()*noun.length)] + Math.floor(Math.random()*999);
}

// Determine if a transaction gets traced
function isTraced(userId, guildId) {
  const { hasApp } = require('./laptopDb');
  const { isMember } = require('./illuminatiDb');
  const { getCredit } = require('./creditDb');

  if (TOR_ILLUM_EXEMPT && isMember(guildId, userId)) return false;

  let traceChance = TOR_TRACE_CHANCE;
  // VPN reduces trace chance
  if (hasApp(userId, 'vpn_shield')) traceChance *= (1 - TOR_VPN_REDUCTION);
  // High hacking skill (many apps installed) further reduces
  const { getLaptop } = require('./laptopDb');
  const laptop = getLaptop(userId);
  const appCount = (laptop?.apps||[]).length;
  traceChance *= Math.max(0.1, 1 - appCount * 0.05);

  return Math.random() < traceChance;
}

module.exports = {
  preloadTorCache, getListing, getAllListings, getActiveListings, calcSsnPrice, createDataLeak,
  getTorUser, getOrCreateTorUser, saveListing, saveTorUser,
  isTraced, generateHandle,
  TOR_HEAT_ON_BUY, TOR_HEAT_ON_SELL, TOR_TRACE_CHANCE,
};
