// ============================================================
// utils/labelDb.js — Record Label System
// Signing artists (NPC + real), music revenue, contracts
// ============================================================
const { col } = require('./mongo');

let _labels    = {}; // ownerId -> label data
let _contracts = {}; // artistId -> contract data

// NPC Artist archetypes
const NPC_ARTISTS = [
  { id:'rising_star',   name:'Rising Star',      talent:45, hype:60, fanbase:12000,  image:'clean',         weeklyRate:800,   emoji:'⭐' },
  { id:'trap_god',      name:'Trap God',          talent:70, hype:85, fanbase:85000,  image:'controversial', weeklyRate:3200,  emoji:'🎤' },
  { id:'pop_princess',  name:'Pop Princess',      talent:65, hype:90, fanbase:220000, image:'clean',         weeklyRate:8500,  emoji:'👑' },
  { id:'rock_legend',   name:'Rock Legend',       talent:88, hype:55, fanbase:150000, image:'iconic',        weeklyRate:6000,  emoji:'🎸' },
  { id:'underground',   name:'Underground Rapper',talent:80, hype:40, fanbase:28000,  image:'controversial', weeklyRate:1200,  emoji:'🎧' },
  { id:'rnb_queen',     name:'R&B Queen',         talent:75, hype:78, fanbase:175000, image:'iconic',        weeklyRate:7200,  emoji:'🎶' },
  { id:'drill_artist',  name:'Drill Artist',      talent:68, hype:72, fanbase:65000,  image:'controversial', weeklyRate:2800,  emoji:'🔥' },
  { id:'indie_darling', name:'Indie Darling',     talent:82, hype:35, fanbase:18000,  image:'clean',         weeklyRate:900,   emoji:'🎻' },
  { id:'hypeman',       name:'Hypeman',           talent:55, hype:95, fanbase:310000, image:'iconic',        weeklyRate:11000, emoji:'💫' },
  { id:'producer',      name:'Ghost Producer',    talent:92, hype:20, fanbase:8000,   image:'clean',         weeklyRate:4500,  emoji:'🎹' },
];

async function preloadLabelCache() {
  try {
    const [lc, cc] = await Promise.all([col('labels'), col('labelContracts')]);
    const [labels, contracts] = await Promise.all([lc.find({}).toArray(), cc.find({}).toArray()]);
    _labels    = Object.fromEntries(labels.map(d => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    _contracts = Object.fromEntries(contracts.map(d => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    console.log(`🎵 Label cache loaded (${Object.keys(_labels).length} labels)`);
  } catch(e) { console.error('preloadLabelCache error:', e.message); }
}

function getLabel(ownerId)    { return _labels[ownerId] || null; }
function getAllLabels()        { return { ..._labels }; }
function getContract(artistId){ return _contracts[artistId] || null; }
function isSignedArtist(artistId) { return !!_contracts[artistId]; }

async function saveLabel(ownerId, data) {
  _labels[ownerId] = data;
  try { const c=await col('labels'); await c.replaceOne({_id:ownerId},{_id:ownerId,...data},{upsert:true}); }
  catch(e) { console.error('saveLabel error:', e.message); }
}

async function saveContract(artistId, data) {
  _contracts[artistId] = data;
  try { const c=await col('labelContracts'); await c.replaceOne({_id:artistId},{_id:artistId,...data},{upsert:true}); }
  catch(e) { console.error('saveContract error:', e.message); }
}

async function deleteContract(artistId) {
  delete _contracts[artistId];
  try { const c=await col('labelContracts'); await c.deleteOne({_id:artistId}); }
  catch(e) { console.error('deleteContract error:', e.message); }
}

// Calculate revenue per 15min tick for a signed artist
function calcArtistRevenue(contract) {
  const artist    = contract.npcData || { talent:50, hype:50, fanbase:10000 };
  const talent    = artist.talent || 50;
  const hype      = artist.hype   || 50;
  const fanbase   = artist.fanbase|| 10000;
  const imageMult = { clean:1.0, controversial:1.2, iconic:1.5 }[artist.image||'clean'] || 1;
  const base      = Math.floor((talent * 0.4 + hype * 0.3) * (fanbase / 50000) * imageMult * 100);
  const illumMult  = contract.illuminatiControlled ? 2.0 : 1.0;
  const forcedMult = contract.forced ? 1.3 : 1.0;
  const plantMult  = contract.isPlant ? 2.5 : 1.0;
  // Artist tier bonus — higher tier = more revenue
  const { getArtistTier } = require('./phoneDb');
  const { getPhone } = require('./phoneDb');
  let tierMult = 1.0;
  try {
    if (!contract.isNPC) {
      const phone = getPhone(contract.artistId);
      if (phone?.artistCareer) {
        const at = getArtistTier(phone.artistCareer.fame||0);
        tierMult = at.revMult || 1.0;
      }
    }
  } catch {}
  return Math.max(10, Math.floor(base * illumMult * forcedMult * plantMult * tierMult));
}

module.exports = {
  preloadLabelCache, getLabel, getAllLabels, getContract, getAllContracts: () => ({..._contracts}),
  isSignedArtist, saveLabel, saveContract, deleteContract,
  calcArtistRevenue, NPC_ARTISTS,
};
