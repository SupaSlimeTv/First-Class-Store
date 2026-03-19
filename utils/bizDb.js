// ============================================================
// utils/bizDb.js — Business Database
// Stores all business data in data/businesses.json
// ============================================================
const fs   = require('fs');
const path = require('path');

const BIZ_FILE = path.join(__dirname, '../data/businesses.json');

function readBiz() {
  try {
    if (!fs.existsSync(BIZ_FILE)) return {};
    return JSON.parse(fs.readFileSync(BIZ_FILE, 'utf8'));
  } catch { return {}; }
}

function writeBiz(data) {
  fs.writeFileSync(BIZ_FILE, JSON.stringify(data, null, 2));
}

function getBusiness(ownerId) {
  return readBiz()[ownerId] || null;
}

function getBusinessById(bizId) {
  const all = readBiz();
  return Object.values(all).find(b => b.id === bizId) || null;
}

function getBusinessByOwner(ownerId) {
  return readBiz()[ownerId] || null;
}

function getAllBusinesses() {
  return readBiz();
}

function saveBusiness(ownerId, data) {
  const all = readBiz();
  all[ownerId] = data;
  writeBiz(all);
}

function deleteBusiness(ownerId) {
  const all = readBiz();
  delete all[ownerId];
  writeBiz(all);
}

// Business types with base stats
const BIZ_TYPES = {
  restaurant:  { name: 'Restaurant',    emoji: '🍽️',  baseIncome: 200, baseCost: 5000,  upgradeCost: 2500, maxLevel: 10, description: 'Feed the server. Hungry customers pay well.' },
  pharmacy:    { name: 'Pharmacy',      emoji: '💊',  baseIncome: 350, baseCost: 8000,  upgradeCost: 4000, maxLevel: 10, description: 'Legal drugs only. Very legal.' },
  casino:      { name: 'Casino',        emoji: '🎰',  baseIncome: 500, baseCost: 15000, upgradeCost: 7500, maxLevel: 10, description: 'House always wins. Except when it doesn\'t.' },
  barbershop:  { name: 'Barbershop',    emoji: '💈',  baseIncome: 150, baseCost: 3000,  upgradeCost: 1500, maxLevel: 10, description: 'Waves, fades, and fresh cuts.' },
  carwash:     { name: 'Car Wash',      emoji: '🚗',  baseIncome: 180, baseCost: 4000,  upgradeCost: 2000, maxLevel: 10, description: 'Clean cars, clean money.' },
  recordlabel: { name: 'Record Label',  emoji: '🎵',  baseIncome: 400, baseCost: 12000, upgradeCost: 6000, maxLevel: 10, description: 'Find the next big artist. Or don\'t.' },
  realestate:  { name: 'Real Estate',   emoji: '🏠',  baseIncome: 600, baseCost: 20000, upgradeCost: 10000, maxLevel: 10, description: 'Location, location, location.' },
  techstartup: { name: 'Tech Startup',  emoji: '💻',  baseIncome: 450, baseCost: 18000, upgradeCost: 9000, maxLevel: 10, description: 'Disrupt everything. Profit later.' },
  streetfood:  { name: 'Street Food',   emoji: '🌮',  baseIncome: 120, baseCost: 2000,  upgradeCost: 1000, maxLevel: 10, description: 'Best tacos in the server. No contest.' },
  gym:         { name: 'Gym',           emoji: '🏋️', baseIncome: 250, baseCost: 6000,  upgradeCost: 3000, maxLevel: 10, description: 'Do you even lift? Your customers do.' },
};

// Calculate current income based on level and employees
function calcIncome(biz) {
  const type       = BIZ_TYPES[biz.type];
  if (!type) return 0;
  const levelBonus = biz.level * 0.15;           // +15% per level
  const empBonus   = (biz.employees?.length || 0) * 0.10; // +10% per employee
  const baseRate   = type.baseIncome * (1 + levelBonus + empBonus);
  return Math.floor(baseRate);
}

module.exports = { getBusiness, getBusinessById, getBusinessByOwner, getAllBusinesses, saveBusiness, deleteBusiness, BIZ_TYPES, calcIncome };
