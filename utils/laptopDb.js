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
  ssn_scanner: {
    name:'SSN Scanner', emoji:'🪪', category:'hack', baseSuccess:40,
    desc:'Scans a target and steals their full SSN + credit profile. Required before running Credit Cracker or Card Drainer. Full SSN sent to you via DM privately.',
  },
  credit_cracker: {
    name:'Credit Cracker', emoji:'💳', category:'hack', baseSuccess:35,
    desc:'Uses a stolen SSN to open a fraudulent credit card under the victim's name. Charges money to their account and tanks their credit score by 45 points.',
  },
  card_drainer: {
    name:'Card Drainer', emoji:'💸', category:'hack', baseSuccess:45,
    desc:'Remotely maxes out a victim's credit card, draining their available limit directly to your wallet. Requires their SSN on file first.',
  },
  biz_intrude: {
    name:'Biz Intruder', emoji:'🏢', category:'hack', baseSuccess:50,
    desc:'Breaks into a business account using their routing number. Can check balances, withdraw revenue, or launder dirty money through their books.',
  },
  keylogger: {
    name:'Keylogger Pro', emoji:'⌨️', category:'hack', bonusPct:20,
    desc:'Passive app — runs in the background and captures credentials from all your hacking attempts. Gives +20% success rate on every phishing and hacking operation.',
  },
  vpn_shield: {
    name:'VPN Shield', emoji:'🛡️', category:'defense', bonusPct:30,
    desc:'Passive app — routes all your criminal activity through encrypted tunnels. Reduces your chance of being traced on TOR transactions and hacks by 60%. Illuminati members are always exempt.',
  },
  // Finance
  bank_mirror: {
    name:'Bank Mirror', emoji:'🏦', category:'finance', baseSuccess:100,
    desc:'Read-only mirror of any bank account via routing number. Shows wallet, bank balance, and business revenue. Always succeeds — 100% success rate. Use with /laptop run routing:<number>.',
  },
  launder_bot: {
    name:'LaunderBot', emoji:'🧺', category:'finance', bonusPct:15,
    desc:'Passive app — upgrades your money laundering rate by 15%. Higher quality tiers increase the clean rate further (up to 85% clean at Tier 5). Works with /launder and gang dirty money.',
  },
  // Intel
  stalker_app: {
    name:'Stalker App', emoji:'👁️', category:'intel', baseSuccess:60,
    desc:'Pulls a full dossier on any user — wallet, bank, home tier, business, gang, credit score, routing number, and debit card number. Stolen card auto-saved to your hacker profile for draining.',
  },
  dark_search: {
    name:'DarkSearch', emoji:'🔍', category:'intel', baseSuccess:55,
    desc:'Searches the TOR dark web marketplace for active listings tied to a target user or routing number. Shows what data is already for sale on them. Use with /laptop run target:@user.',
  },
  home_hack: {
    name:'HomeHack Pro', emoji:'🏚️', category:'hack', baseSuccess:45,
    desc:'Remotely disables a homeowner's security system for 30 minutes. Sets their break-in defense to 0% and disables cameras. Victim gets a warning DM. Follow up with /use break-in-kit immediately.',
  },
  tor_browser: {
    name:'TOR Browser', emoji:'🌐', category:'intel', baseSuccess:100,
    desc:'Passive app — gives you access to the dark web marketplace commands. With this installed your TOR trace risk drops by an additional 20%. Use /tor market to browse · /tor buy to purchase stolen identities · /tor sell to list your own data.',
  },
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
