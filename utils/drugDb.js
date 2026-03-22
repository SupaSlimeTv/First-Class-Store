// ============================================================
// utils/drugDb.js — Drug Market System
// Admins define drugs in the dashboard
// Burner phone users can order across the border
// ============================================================
const { col } = require('./mongo');

let _drugs = [];
let _orders = {}; // userId -> pending order

async function preloadDrugCache() {
  try {
    const c    = await col('drugs');
    const docs = await c.find({}).toArray();
    _drugs = docs.map(d => { const o={...d}; delete o._id; return { id:d._id, ...o }; });
    console.log(`💊 Drug cache loaded (${_drugs.length} drugs)`);
  } catch(e) { console.error('preloadDrugCache error:', e.message); }
}

function getDrugs()          { return [..._drugs]; }
function getDrug(id)         { return _drugs.find(d => d.id === id) || null; }

async function saveDrug(drug) {
  const idx = _drugs.findIndex(d => d.id === drug.id);
  if (idx === -1) _drugs.push(drug); else _drugs[idx] = drug;
  try {
    const c = await col('drugs');
    await c.replaceOne({ _id: drug.id }, { _id: drug.id, ...drug }, { upsert: true });
  } catch(e) { console.error('saveDrug error:', e.message); }
}

async function deleteDrug(id) {
  _drugs = _drugs.filter(d => d.id !== id);
  try {
    const c = await col('drugs');
    await c.deleteOne({ _id: id });
  } catch(e) { console.error('deleteDrug error:', e.message); }
}

function getPendingOrder(userId)           { return _orders[userId] || null; }
function setPendingOrder(userId, order)    { _orders[userId] = order; }
function clearPendingOrder(userId)         { delete _orders[userId]; }

module.exports = {
  preloadDrugCache, getDrugs, getDrug, saveDrug, deleteDrug,
  getPendingOrder, setPendingOrder, clearPendingOrder,
};
