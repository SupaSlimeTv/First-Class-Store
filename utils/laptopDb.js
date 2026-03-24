// ============================================================
// utils/laptopDb.js — Laptop App System
// Apps are store items. The laptop is a device, apps define capability.
// ============================================================
const { col } = require('./mongo');

let _laptops = {}; // userId -> { apps:[], deviceId, installedAt }

// Built-in app types — admins can create custom ones via store items
// with effect type 'laptop_app' and appType field
const BUILTIN_APPS = {
  // Hacking / criminal
  ssn_scanner:    { name:'SSN Scanner',      emoji:'🪪', category:'hack',     desc:'Scan targets for SSN — required for /hack ssn',       baseSuccess:40 },
  credit_cracker: { name:'Credit Cracker',   emoji:'💳', category:'hack',     desc:'Open fraud cards on stolen SSNs',                     baseSuccess:35 },
  card_drainer:   { name:'Card Drainer',     emoji:'💸', category:'hack',     desc:'Drain credit cards remotely',                         baseSuccess:45 },
  biz_intrude:    { name:'Biz Intruder',     emoji:'🏢', category:'hack',     desc:'Access business accounts via routing numbers',        baseSuccess:50 },
  keylogger:      { name:'Keylogger Pro',    emoji:'⌨️', category:'hack',     desc:'+20% success on all phishing attacks',                bonusPct:20    },
  vpn_shield:     { name:'VPN Shield',       emoji:'🛡️', category:'defense',  desc:'Reduces chance of being traced back on hacks',        bonusPct:30    },
  // Finance
  bank_mirror:    { name:'Bank Mirror',      emoji:'🏦', category:'finance',  desc:'Read-only access to any routing number — no item req', baseSuccess:100 },
  launder_bot:    { name:'LaunderBot',       emoji:'🧺', category:'finance',  desc:'+15% clean rate when laundering dirty money',         bonusPct:15    },
  // Intel
  stalker_app:    { name:'Stalker App',      emoji:'👁️', category:'intel',    desc:'View any user full profile (home, status, biz)',      baseSuccess:60 },
  dark_search:    { name:'DarkSearch',       emoji:'🔍', category:'intel',    desc:'Search SSN database — find who owns a given SSN',     baseSuccess:55 },
};

async function preloadLaptopCache() {
  try {
    const c    = await col('laptops');
    const docs = await c.find({}).toArray();
    for (const d of docs) {
      const id = d._id; const o = {...d}; delete o._id;
      _laptops[id] = o;
    }
    console.log(`💻 Laptop cache loaded (${Object.keys(_laptops).length} devices)`);
  } catch(e) { console.error('preloadLaptopCache error:', e.message); }
}

function getLaptop(userId)    { return _laptops[userId] || null; }
function getAllLaptops()       { return { ..._laptops }; }
function hasApp(userId, appId){ return (getLaptop(userId)?.apps||[]).some(a=>a.id===appId); }
function getApp(userId, appId){ return (getLaptop(userId)?.apps||[]).find(a=>a.id===appId)||null; }

async function saveLaptop(userId, data) {
  _laptops[userId] = data;
  try {
    const c = await col('laptops');
    await c.replaceOne({_id:userId},{_id:userId,...data},{upsert:true});
  } catch(e) { console.error('saveLaptop error:', e.message); }
}

// Calculate effective success rate for an action, factoring in installed apps
function getEffectiveSuccess(userId, actionType) {
  const laptop = getLaptop(userId);
  if (!laptop) return 0;
  const apps = laptop.apps || [];
  // Start with base from relevant app
  const appMap = {
    hack_ssn:    'ssn_scanner',
    hack_fraud:  'credit_cracker',
    hack_drain:  'card_drainer',
    phish:       'keylogger',
    biz_access:  'biz_intrude',
    intel:       'stalker_app',
    launder:     'launder_bot',
  };
  const primaryApp = appMap[actionType];
  const installed  = primaryApp ? apps.find(a=>a.id===primaryApp) : null;
  const base       = installed ? (BUILTIN_APPS[primaryApp]?.baseSuccess || installed.baseSuccess || 40) : 30;
  // Bonus from quality tier
  const qualityBonus = installed ? (installed.quality||0) * 5 : 0;
  // VPN reduces tracing but doesn't affect success
  return Math.min(90, base + qualityBonus);
}

module.exports = {
  preloadLaptopCache, getLaptop, getAllLaptops, hasApp, getApp, saveLaptop,
  getEffectiveSuccess, BUILTIN_APPS,
};
