// ============================================================
// utils/bizDb.js — MongoDB Edition
// Collection: businesses
// ============================================================

const { col } = require('./mongo');

async function getBusiness(ownerId) {
  const c = await col('businesses');
  return await c.findOne({ _id: ownerId }) || null;
}

async function getBusinessById(bizId) {
  const c = await col('businesses');
  return await c.findOne({ id: bizId }) || null;
}

async function getBusinessByOwner(ownerId) {
  return await getBusiness(ownerId);
}

async function getAllBusinesses() {
  const c    = await col('businesses');
  const docs = await c.find({}).toArray();
  return Object.fromEntries(docs.map(d => [d._id, d]));
}

async function saveBusiness(ownerId, data) {
  const c = await col('businesses');
  const { _id, ...rest } = data;
  await c.updateOne({ _id: ownerId }, { $set: rest }, { upsert: true });
}

async function deleteBusiness(ownerId) {
  const c = await col('businesses');
  await c.deleteOne({ _id: ownerId });
}

const BIZ_TYPES = {
  restaurant:  { name: 'Restaurant',   emoji: '🍽️',  baseIncome: 200,  baseCost: 5000,  upgradeCost: 2500,  maxLevel: 10, description: 'Feed the server. Hungry customers pay well.' },
  pharmacy:    { name: 'Pharmacy',     emoji: '💊',  baseIncome: 350,  baseCost: 8000,  upgradeCost: 4000,  maxLevel: 10, description: 'Legal drugs only. Very legal.' },
  casino:      { name: 'Casino',       emoji: '🎰',  baseIncome: 500,  baseCost: 15000, upgradeCost: 7500,  maxLevel: 10, description: 'House always wins. Except when it doesn\'t.' },
  barbershop:  { name: 'Barbershop',   emoji: '💈',  baseIncome: 150,  baseCost: 3000,  upgradeCost: 1500,  maxLevel: 10, description: 'Waves, fades, and fresh cuts.' },
  carwash:     { name: 'Car Wash',     emoji: '🚗',  baseIncome: 180,  baseCost: 4000,  upgradeCost: 2000,  maxLevel: 10, description: 'Clean cars, clean money.' },
  recordlabel: { name: 'Record Label', emoji: '🎵',  baseIncome: 400,  baseCost: 12000, upgradeCost: 6000,  maxLevel: 10, description: 'Find the next big artist. Or don\'t.' },
  realestate:  { name: 'Real Estate',  emoji: '🏠',  baseIncome: 600,  baseCost: 20000, upgradeCost: 10000, maxLevel: 10, description: 'Location, location, location.' },
  techstartup: { name: 'Tech Startup', emoji: '💻',  baseIncome: 450,  baseCost: 18000, upgradeCost: 9000,  maxLevel: 10, description: 'Disrupt everything. Profit later.' },
  streetfood:  { name: 'Street Food',  emoji: '🌮',  baseIncome: 120,  baseCost: 2000,  upgradeCost: 1000,  maxLevel: 10, description: 'Best tacos in the server. No contest.' },
  gym:         { name: 'Gym',          emoji: '🏋️', baseIncome: 250,  baseCost: 6000,  upgradeCost: 3000,  maxLevel: 10, description: 'Do you even lift? Your customers do.' },
};

function calcIncome(biz) {
  const type = BIZ_TYPES[biz.type];
  if (!type) return 0;
  const levelBonus = biz.level * 0.15;
  const empBonus   = (biz.employees?.length || 0) * 0.10;
  return Math.floor(type.baseIncome * (1 + levelBonus + empBonus));
}

module.exports = { getBusiness, getBusinessById, getBusinessByOwner, getAllBusinesses, saveBusiness, deleteBusiness, BIZ_TYPES, calcIncome };
