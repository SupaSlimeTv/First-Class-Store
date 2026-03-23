// ============================================================
// utils/bizDb.js — Business Database (MongoDB)
// Each user can own:
//   • 1 legit business
//   • Up to 3 cash/laundering businesses (gang owners only)
// Stored as array docs: { _id: userId, businesses: [...] }
// ============================================================
const { col } = require('./mongo');

let _cache = {}; // userId -> { businesses: [...] }

async function preloadBizCache() {
  try {
    const c    = await col('businesses');
    const docs = await c.find({}).toArray();
    _cache = {};
    for (const d of docs) {
      const id = d._id;
      if (Array.isArray(d.businesses)) {
        // New format
        _cache[id] = d.businesses;
      } else {
        // Old format — migrate: single business becomes legit slot
        const migrated = { ...d };
        delete migrated._id;
        _cache[id] = [migrated];
      }
    }
    console.log(`🏢 Biz cache loaded (${Object.keys(_cache).length} owners)`);
  } catch(e) { console.error('bizDb preload error:', e.message); }
}

// Get all businesses for a user
function getBusinesses(ownerId) { return _cache[ownerId] || []; }

// Get first legit business
function getBusiness(ownerId) {
  return (_cache[ownerId] || []).find(b => BIZ_TYPES[b.type]?.isLegit || !BIZ_TYPES[b.type]?.isCashBusiness) || null;
}

// Get business by type slot
function getBusinessByType(ownerId, type) {
  return (_cache[ownerId] || []).find(b => b.type === type) || null;
}

// Get all cash businesses
function getCashBusinesses(ownerId) {
  return (_cache[ownerId] || []).filter(b => BIZ_TYPES[b.type]?.isCashBusiness);
}

function getBusinessById(bizId) {
  for (const [uid, list] of Object.entries(_cache)) {
    const found = list.find(b => b.id === bizId);
    if (found) return { ...found, ownerId: uid };
  }
  return null;
}

function getAllBusinesses() {
  const all = {};
  for (const [uid, list] of Object.entries(_cache)) {
    for (const b of list) all[b.id || uid] = { ...b, ownerId: uid };
  }
  return all;
}

async function _saveAll(ownerId) {
  try {
    const c = await col('businesses');
    await c.replaceOne(
      { _id: ownerId },
      { _id: ownerId, businesses: _cache[ownerId] || [] },
      { upsert: true }
    );
  } catch(e) { console.error('bizDb save error:', e.message); }
}

// Save or update a business (matched by type)
async function saveBusiness(ownerId, data) {
  if (!_cache[ownerId]) _cache[ownerId] = [];
  const idx = _cache[ownerId].findIndex(b => b.type === data.type || b.id === data.id);
  if (idx >= 0) _cache[ownerId][idx] = data;
  else _cache[ownerId].push(data);
  await _saveAll(ownerId);
}

// Delete a specific business by type
async function deleteBusiness(ownerId, type) {
  if (!_cache[ownerId]) return;
  if (type) {
    _cache[ownerId] = _cache[ownerId].filter(b => b.type !== type);
  } else {
    // Legacy: delete first/only business
    _cache[ownerId] = _cache[ownerId].slice(1);
  }
  await _saveAll(ownerId);
}

// ── BUSINESS TYPE FLAGS ───────────────────────────────────
const BIZ_TYPES = {
  // Legit businesses (1 max per user)
  restaurant:  { name:'Restaurant',   emoji:'🍽️', baseIncome:200, baseCost:5000,  upgradeCost:2500,  maxLevel:10, isLegit:true, description:'Feed the server. Hungry customers pay well.' },
  pharmacy:    { name:'Pharmacy',     emoji:'💊', baseIncome:350, baseCost:8000,  upgradeCost:4000,  maxLevel:10, isLegit:true, description:'Legal drugs only. Very legal.' },
  casino:      { name:'Casino',       emoji:'🎰', baseIncome:500, baseCost:15000, upgradeCost:7500,  maxLevel:10, isLegit:true, description:"House always wins. Except when it doesn't." },
  barbershop:  { name:'Barbershop',   emoji:'💈', baseIncome:150, baseCost:3000,  upgradeCost:1500,  maxLevel:10, isLegit:true, description:'Waves, fades, and fresh cuts.' },
  carwash:     { name:'Car Wash',     emoji:'🚗', baseIncome:180, baseCost:4000,  upgradeCost:2000,  maxLevel:10, isLegit:true, description:'Clean cars, clean money.' },
  recordlabel: { name:'Record Label', emoji:'🎵', baseIncome:400, baseCost:12000, upgradeCost:6000,  maxLevel:10, isLegit:true, description:"Find the next big artist. Or don't." },
  realestate:  { name:'Real Estate',  emoji:'🏠', baseIncome:600, baseCost:20000, upgradeCost:10000, maxLevel:10, isLegit:true, description:'Location, location, location.' },
  techstartup: { name:'Tech Startup', emoji:'💻', baseIncome:450, baseCost:18000, upgradeCost:9000,  maxLevel:10, isLegit:true, description:'Disrupt everything. Profit later.' },
  streetfood:  { name:'Street Food',  emoji:'🌮', baseIncome:120, baseCost:2000,  upgradeCost:1000,  maxLevel:10, isLegit:true, description:'Best tacos in the server. No contest.' },
  gym:         { name:'Gym',          emoji:'🏋️', baseIncome:250, baseCost:6000,  upgradeCost:3000,  maxLevel:10, isLegit:true, description:'Do you even lift? Your customers do.' },
  cryptolab:   { name:'Crypto Lab',   emoji:'🖥️', baseIncome:400, baseCost:25000, upgradeCost:12000, maxLevel:10, isLegit:true, description:'Launch your own memecoins. 3 max. Pump or dump.' },
  // Cash-only / laundering (up to 3, gang owners only)
  laundromat:  { name:'Laundromat',    emoji:'🫧', baseIncome:300, baseCost:18000, upgradeCost:8000,  maxLevel:10, isCashBusiness:true, description:'Cash-only. Perfect for cleaning things up.' },
  carwash2:    { name:'Cash Car Wash', emoji:'🚿', baseIncome:250, baseCost:12000, upgradeCost:6000,  maxLevel:10, isCashBusiness:true, description:'High-volume cash. No questions asked.' },
  nightclub:   { name:'Nightclub',     emoji:'🎵', baseIncome:600, baseCost:35000, upgradeCost:15000, maxLevel:10, isCashBusiness:true, description:'Cash at the door every night. Prime laundering front.' },
};

function calcIncome(biz) {
  const type = BIZ_TYPES[biz.type];
  if (!type) return 0;
  return Math.floor(type.baseIncome * (1 + biz.level * 0.15 + (biz.employees?.length||0) * 0.10));
}

module.exports = {
  preloadBizCache,
  getBusiness, getBusinesses, getBusinessByType, getCashBusinesses,
  getBusinessById, getAllBusinesses,
  saveBusiness, deleteBusiness,
  BIZ_TYPES, calcIncome,
};
