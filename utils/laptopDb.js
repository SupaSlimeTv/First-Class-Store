// utils/laptopDb.js — Laptop & Hacking App System
const { col } = require('./mongo');

let _laptops = {};

const BUILTIN_APPS = {
  ssn_scanner: {
    name:'SSN Scanner', emoji:'🪪', category:'hack', baseSuccess:40,
    desc:'Scans a target and steals their full SSN and credit profile. Required before running Credit Cracker or Card Drainer. Full SSN sent to you via DM privately.',
  },
  credit_cracker: {
    name:'Credit Cracker', emoji:'💳', category:'hack', baseSuccess:35,
    desc:'Uses a stolen SSN to open a fraudulent credit card under the victim name. Charges money to their account and tanks their credit score by 45 points.',
  },
  card_drainer: {
    name:'Card Drainer', emoji:'💸', category:'hack', baseSuccess:45,
    desc:'Remotely maxes out a victim credit card, draining their available limit directly to your wallet. Requires their SSN on file first.',
  },
  biz_intrude: {
    name:'Biz Intruder', emoji:'🏢', category:'hack', baseSuccess:50,
    desc:'Breaks into a business account using their routing number. Can check balances, withdraw revenue, or launder dirty money through their books.',
  },
  keylogger: {
    name:'Keylogger Pro', emoji:'⌨️', category:'hack', bonusPct:20,
    desc:'Passive app — runs in the background and captures credentials. Gives +20% success rate on every phishing and hacking operation. No inputs needed.',
  },
  vpn_shield: {
    name:'VPN Shield', emoji:'🛡️', category:'defense', bonusPct:30,
    desc:'Passive app — routes all criminal activity through encrypted tunnels. Reduces your chance of being traced on TOR and hacks by 60%. No inputs needed.',
  },
  bank_mirror: {
    name:'Bank Mirror', emoji:'🏦', category:'finance', baseSuccess:100,
    desc:'Read-only mirror of any bank account via routing number. Shows wallet, bank balance, and business revenue. Always succeeds — 100% success rate.',
  },
  launder_bot: {
    name:'LaunderBot', emoji:'🧺', category:'finance', bonusPct:15,
    desc:'Passive app — upgrades your money laundering rate by 15%. Higher quality tiers increase the clean rate further up to 85%. Works with /launder command.',
  },
  stalker_app: {
    name:'Stalker App', emoji:'👁️', category:'intel', baseSuccess:60,
    desc:'Pulls a full dossier on any user — wallet, bank, home tier, business, gang, credit score, routing number, and debit card number. Stolen card auto-saved for draining.',
  },
  dark_search: {
    name:'DarkSearch', emoji:'🔍', category:'intel', baseSuccess:55,
    desc:'Searches the TOR dark web marketplace for active listings tied to a target user or routing number. Shows what data is already listed for sale on them.',
  },
  home_hack: {
    name:'HomeHack Pro', emoji:'🏚️', category:'hack', baseSuccess:45,
    desc:'Remotely disables a homeowner security system for 30 minutes. Sets break-in defense to 0% and disables cameras. Follow up with /use break-in-kit immediately.',
  },
  tor_browser: {
    name:'TOR Browser', emoji:'🌐', category:'intel', baseSuccess:100,
    desc:'Passive app — gives you access to the dark web marketplace. Reduces TOR trace risk by extra 20%. Use /tor market to browse and /tor buy to purchase stolen identities.',
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

function getLaptop(userId)  { return _laptops[userId] || null; }
function hasApp(userId, appId) {
  return !!(_laptops[userId]?.apps||[]).find(a => a.id === appId);
}

async function saveLaptop(userId, data) {
  _laptops[userId] = data;
  try {
    const c = await col('laptops');
    await c.replaceOne({ _id: userId }, { _id: userId, ...data }, { upsert: true });
  } catch(e) { console.error('saveLaptop error:', e.message); }
}

function getEffectiveSuccess(userId, appId) {
  const laptop     = getLaptop(userId);
  const installed  = laptop?.apps?.find(a => a.id === appId);
  const primaryApp = installed;
  const base       = installed ? (BUILTIN_APPS[appId]?.baseSuccess || installed.baseSuccess || 40) : 30;
  const quality    = installed?.quality || 1;
  // Each quality tier adds +5% up to +25%
  const qualBonus  = (quality - 1) * 5;
  // Keylogger bonus
  const hasKL      = hasApp(userId, 'keylogger');
  const klBonus    = hasKL ? (BUILTIN_APPS.keylogger.bonusPct || 20) : 0;
  return Math.min(95, base + qualBonus + klBonus);
}

module.exports = {
  preloadLaptopCache, getLaptop, saveLaptop, hasApp, BUILTIN_APPS, getEffectiveSuccess,
};
