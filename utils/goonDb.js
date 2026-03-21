// ============================================================
// utils/goonDb.js — Gang Goon & NPC System
// ============================================================
const { col } = require('./mongo');

let _goons = {}; // gangId -> goon roster data

async function preloadGoonCache() {
  try {
    const c    = await col('gangGoons');
    const docs = await c.find({}).toArray();
    _goons = Object.fromEntries(docs.map(d => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    console.log(`👊 Goon cache loaded (${Object.keys(_goons).length} gangs)`);
  } catch(e) { console.error('preloadGoonCache error:', e.message); }
}

function getGangGoons(gangId)  { return _goons[gangId] || { goons:[], dirtyMoney:0, lastTraffick:null, lastAttack:{} }; }
function getAllGangGoons()      { return { ..._goons }; }

async function saveGangGoons(gangId, data) {
  _goons[gangId] = data;
  try {
    const c = await col('gangGoons');
    await c.replaceOne({ _id: gangId }, { _id: gangId, ...data }, { upsert: true });
  } catch(e) { console.error('saveGangGoons error:', e.message); }
}

// ── GOON TYPES ────────────────────────────────────────────
const GOON_TYPES = {
  // Basic crew
  lookout: {
    name:'Lookout',       emoji:'👀', tier:1, cost:2000,
    attack:3,  defense:2, smartness:5, loyalty:70,
    warBonus:2, traffickRate:50,  attackBonus:0,
    desc:'Keeps watch. Low combat but good intel.',
    requires: null,
  },
  thug: {
    name:'Thug',          emoji:'👊', tier:1, cost:5000,
    attack:10, defense:8, smartness:3, loyalty:60,
    warBonus:5, traffickRate:80, attackBonus:15,
    desc:'Basic muscle. Gets the job done.',
    requires: null,
  },
  dealer: {
    name:'Street Dealer',  emoji:'💊', tier:2, cost:8000,
    attack:6,  defense:5, smartness:8, loyalty:65,
    warBonus:3, traffickRate:200, attackBonus:5,
    desc:'Pushes product. High drug income.',
    requires: null,
  },
  enforcer: {
    name:'Enforcer',       emoji:'🪖', tier:2, cost:15000,
    attack:20, defense:15, smartness:7, loyalty:75,
    warBonus:10, traffickRate:100, attackBonus:25,
    desc:'Serious muscle. High war impact.',
    requires: 'armory',
  },
  hitman: {
    name:'Hitman',         emoji:'🎯', tier:3, cost:30000,
    attack:35, defense:20, smartness:12, loyalty:80,
    warBonus:20, traffickRate:150, attackBonus:50,
    desc:'Professional. Deadly in conflicts.',
    requires: 'mafia',
  },
  consigliere: {
    name:'Consigliere',    emoji:'🧠', tier:3, cost:50000,
    attack:10, defense:10, smartness:25, loyalty:90,
    warBonus:15, traffickRate:300, attackBonus:20,
    desc:'The brain. Massive drug income, strategy bonus.',
    requires: 'mafia',
  },
  underboss: {
    name:'Underboss',      emoji:'💼', tier:4, cost:100000,
    attack:40, defense:35, smartness:20, loyalty:95,
    warBonus:35, traffickRate:500, attackBonus:75,
    desc:'Second in command. Elite stats across the board.',
    requires: 'mafia',
  },
  accountant: {
    name:'NPC Accountant', emoji:'🧾', tier:2, cost:20000,
    attack:2,  defense:2, smartness:30, loyalty:85,
    warBonus:0, traffickRate:0,  attackBonus:0,
    desc:'Launders dirty money. Required for auto-laundering.',
    isAccountant: true,
    requires: null,
  },
};

// Max goons per gang (scales with gang level/upgrades)
function maxGoons(gang) {
  const base = 5;
  const armoryBonus = (gang.armory || 0) * 2;
  const mafiaBonus  = gang.gangType === 'mafia' ? 5 : 0;
  return base + armoryBonus + mafiaBonus;
}

// Total war bonus from goons
function goonWarBonus(goons) {
  return (goons||[]).reduce((s,g) => s + (GOON_TYPES[g.type]?.warBonus||0) * (g.count||1), 0);
}

// Total traffick rate per tick (dirty money/min)
function goonTraffickRate(goons) {
  return (goons||[]).reduce((s,g) => {
    const gt = GOON_TYPES[g.type];
    if (!gt || gt.isAccountant) return s;
    return s + (gt.traffickRate||0) * (g.count||1);
  }, 0);
}

// Check if gang has accountant
function hasAccountant(goons) {
  return (goons||[]).some(g => GOON_TYPES[g.type]?.isAccountant);
}

module.exports = {
  preloadGoonCache, getGangGoons, saveGangGoons, getAllGangGoons,
  GOON_TYPES, maxGoons, goonWarBonus, goonTraffickRate, hasAccountant,
};
