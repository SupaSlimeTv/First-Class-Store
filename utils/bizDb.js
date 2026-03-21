// ============================================================
// utils/bizDb.js — Business Database (MongoDB)
// ============================================================
const { col } = require('./mongo');

// In-memory cache so sync callers still work
let _cache = {};
let _loaded = false;

async function loadCache() {
  try {
    const c    = await col('businesses');
    const docs = await c.find({}).toArray();
    _cache = {};
    for (const d of docs) { const id = d._id; delete d._id; _cache[id] = d; }
    _loaded = true;
  } catch(e) { console.error('bizDb loadCache error:', e.message); }
}

// Call on bot ready
async function preloadBizCache() { await loadCache(); }

function readBiz()              { return _cache; }
function getBusiness(ownerId)   { return _cache[ownerId] || null; }
function getBusinessById(bizId) { return Object.values(_cache).find(b => b.id === bizId) || null; }
function getBusinessByOwner(id) { return _cache[id] || null; }
function getAllBusinesses()      { return { ..._cache }; }

async function saveBusiness(ownerId, data) {
  _cache[ownerId] = data;
  try {
    const c = await col('businesses');
    await c.replaceOne({ _id: ownerId }, { _id: ownerId, ...data }, { upsert: true });
  } catch(e) { console.error('saveBusiness error:', e.message); }
}

async function deleteBusiness(ownerId) {
  delete _cache[ownerId];
  try {
    const c = await col('businesses');
    await c.deleteOne({ _id: ownerId });
  } catch(e) { console.error('deleteBusiness error:', e.message); }
}

// Business types
// ── BUSINESS TYPE FLAGS ───────────────────────────────────
// isLegit=true    → standard legal business
// isCashBusiness=true → cash-only front, can launder dirty money
// Both types: generate revenue, can have employees, upgradeable

const BIZ_TYPES = {
  restaurant:  { name:'Restaurant',   emoji:'🍽️', baseIncome:200, baseCost:5000,  upgradeCost:2500,  maxLevel:10, isLegit:true, description:'Feed the server. Hungry customers pay well.' },
  pharmacy:    { name:'Pharmacy',     emoji:'💊', baseIncome:350, baseCost:8000,  upgradeCost:4000,  maxLevel:10, isLegit:true, description:'Legal drugs only. Very legal.' },
  casino:      { name:'Casino',       emoji:'🎰', baseIncome:500, baseCost:15000, upgradeCost:7500,  maxLevel:10, isLegit:true, description:"House always wins. Except when it doesn't." },
  barbershop:  { name:'Barbershop',   emoji:'💈', baseIncome:150, baseCost:3000,  upgradeCost:1500,  maxLevel:10, isLegit:true, description:'Waves, fades, and fresh cuts.' },
  carwash:     { name:'Car Wash',     emoji:'🚗', baseIncome:180, baseCost:4000,  upgradeCost:2000,  maxLevel:10, isLegit:true, description:'Clean cars, clean money.' },
  recordlabel: { name:'Record Label', emoji:'🎵', baseIncome:400, baseCost:12000, upgradeCost:6000,  maxLevel:10, isLegit:true, description:"Find the next big artist. Or don't." },
  realestate:  { name:'Real Estate',  emoji:'🏠', baseIncome:600, baseCost:20000, upgradeCost:10000, maxLevel:10, isLegit:true, description:'Location, location, location.' },
  techstartup: { name:'Tech Startup', emoji:'💻', baseIncome:450, baseCost:18000, upgradeCost:9000,  maxLevel:10, isLegit:true, description:'Disrupt everything. Profit later.' },
  streetfood:  { name:'Street Food',  emoji:'🌮', baseIncome:120, baseCost:2000,  upgradeCost:1000,  maxLevel:10, isLegit:true, description:'Best tacos in the server. No contest.' },
  gym:         { name:'Gym',          emoji:'🏋️',baseIncome:250, baseCost:6000,  upgradeCost:3000,  maxLevel:10, isLegit:true, description:'Do you even lift? Your customers do.' },
  cryptolab:   { name:'Crypto Lab',   emoji:'🖥️', baseIncome:400, baseCost:25000, upgradeCost:12000, maxLevel:10, isLegit:true, description:'Launch your own memecoins. 3 max. Pump or dump — your call.' },
  laundromat:  { name:'Laundromat',    emoji:'🫧', baseIncome:300, baseCost:18000, upgradeCost:8000,  maxLevel:10, description:'Cash-only. Perfect for... cleaning things up. Gang dirty money flows here.', isCashBusiness:true },
  carwash2:    { name:'Cash Car Wash', emoji:'🚿', baseIncome:250, baseCost:12000, upgradeCost:6000,  maxLevel:10, description:'High-volume cash. No questions asked.', isCashBusiness:true },
  nightclub:   { name:'Nightclub',     emoji:'🎵', baseIncome:600, baseCost:35000, upgradeCost:15000, maxLevel:10, description:'Cash at the door every night. Prime laundering front.', isCashBusiness:true },
};

function calcIncome(biz) {
  const type = BIZ_TYPES[biz.type];
  if (!type) return 0;
  const levelBonus = biz.level * 0.15;
  const empBonus   = (biz.employees?.length || 0) * 0.10;
  return Math.floor(type.baseIncome * (1 + levelBonus + empBonus));
}

module.exports = { getBusiness, getBusinessById, getBusinessByOwner, getAllBusinesses, saveBusiness, deleteBusiness, preloadBizCache, BIZ_TYPES, calcIncome };
