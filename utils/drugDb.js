// ============================================================
// utils/drugDb.js — Drug Market System
// Admins define drugs in the dashboard
// Burner phone users can order across the border
// ============================================================
const { col } = require('./mongo');

let _drugs = {}; // guildId -> [...drugs]
let _orders = {}; // userId -> pending order

async function preloadDrugCache() {
  try {
    const c    = await col('drugs');
    const docs = await c.find({}).toArray();
    _drugs = {};
    for (const d of docs) {
      if (d._id.includes(':')) {
        // New format: guildId:drugId
        const gid = d._id.split(':').slice(0,-1).join(':');
        if (!_drugs[gid]) _drugs[gid] = [];
        const o = {...d}; delete o._id;
        _drugs[gid].push({ id: d._id.split(':').pop(), ...o });
      } else {
        // Old format — migrate to default guild
        const gid = process.env.GUILD_ID || 'default';
        if (!_drugs[gid]) _drugs[gid] = [];
        const o = {...d}; delete o._id;
        _drugs[gid].push({ id: d._id, ...o });
      }
    }
    const total = Object.values(_drugs).reduce((s,a)=>s+a.length,0);
    console.log(`💊 Drug cache loaded (${total} drugs)`);
  } catch(e) { console.error('preloadDrugCache error:', e.message); }
}

function getDrugs(guildId) {
  const gid = guildId || process.env.GUILD_ID || 'default';
  return [...(_drugs[gid] || [])];
}
function getDrug(id, guildId) {
  return getDrugs(guildId).find(d => d.id === id) || null;
}

async function saveDrug(drug, guildId) {
  const gid = guildId || process.env.GUILD_ID || 'default';
  if (!_drugs[gid]) _drugs[gid] = [];
  const idx = _drugs[gid].findIndex(d => d.id === drug.id);
  if (idx === -1) _drugs[gid].push(drug); else _drugs[gid][idx] = drug;
  try {
    const c = await col('drugs');
    const key = `${gid}:${drug.id}`;
    await c.replaceOne({ _id: key }, { _id: key, ...drug }, { upsert: true });
  } catch(e) { console.error('saveDrug error:', e.message); }
}

async function deleteDrug(id, guildId) {
  const gid = guildId || process.env.GUILD_ID || 'default';
  if (_drugs[gid]) _drugs[gid] = _drugs[gid].filter(d => d.id !== id);
  try {
    const c = await col('drugs');
    await c.deleteOne({ _id: `${gid}:${id}` });
  } catch(e) { console.error('deleteDrug error:', e.message); }
}

function getPendingOrder(userId)           { return _orders[userId] || null; }
function setPendingOrder(userId, order)    { _orders[userId] = order; }
function clearPendingOrder(userId)         { delete _orders[userId]; }

module.exports = {
  preloadDrugCache, getDrugs, getDrug, saveDrug, deleteDrug,
  getPendingOrder, setPendingOrder, clearPendingOrder,
};
