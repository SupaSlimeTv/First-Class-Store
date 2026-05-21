// utils/laptopDb.js — Laptop & Hacking App System
const { col } = require('./mongo');

let _laptops = {};

// ── DEVICE TIERS ─────────────────────────────────────────────
// builtin → hack_laptop → political_laptop
const DEVICE_TIERS = {
  builtin: {
    name: 'Built-in Laptop',
    label: '💻 Built-in',
    emoji: '💻',
    desc: 'Basic access. Intel and passive apps only. Upgrade to Hacking Laptop to unlock offensive apps.',
    allowedCategories: ['intel', 'defense', 'finance'],
  },
  hack_laptop: {
    name: 'Hacking Laptop',
    label: '💻 Hacking Laptop',
    emoji: '💻',
    desc: 'Full hacking suite. Unlocks SSN Scanner, Credit Cracker, Card Drainer, Biz Intruder, and HomeHack.',
    allowedCategories: ['intel', 'defense', 'finance', 'hack'],
  },
  political_laptop: {
    name: 'Political Laptop',
    label: '🏛️ Political Laptop',
    emoji: '🏛️',
    desc: 'Illuminati-grade device. All hacking apps + classified political operations. Requires Illuminati Political Power faction to use political ops.',
    allowedCategories: ['intel', 'defense', 'finance', 'hack', 'political'],
  },
};

const DEVICE_ORDER = ['builtin', 'hack_laptop', 'political_laptop'];

const BUILTIN_APPS = {
  // ── HACKING (requires hack_laptop+) ───────────────────────
  ssn_scanner: {
    name:'SSN Scanner', emoji:'🪪', category:'hack', baseSuccess:40,
    requiresDevice: 'hack_laptop',
    desc:'Scans a target and steals their full SSN and credit profile. Required before running Credit Cracker. Full SSN sent to you via DM privately.',
  },
  credit_cracker: {
    name:'Credit Cracker', emoji:'💳', category:'hack', baseSuccess:35,
    requiresDevice: 'hack_laptop',
    desc:'Opens a fraudulent credit card using a stolen SSN. Requires you to enter the actual SSN number — not just a user tag. Get the SSN from Keylogger first.',
  },
  card_drainer: {
    name:'Card Drainer', emoji:'💸', category:'hack', baseSuccess:45,
    requiresDevice: 'hack_laptop',
    desc:'Remotely maxes out a victim credit card. Requires Credit Cracker was run on them first to open the fraud card.',
  },
  biz_intrude: {
    name:'Biz Intruder', emoji:'🏢', category:'hack', baseSuccess:50,
    requiresDevice: 'hack_laptop',
    desc:'Breaks into a business account using their routing number. Can check balances, withdraw revenue, or launder dirty money through their books.',
  },
  home_hack: {
    name:'HomeHack Pro', emoji:'🏚️', category:'hack', baseSuccess:45,
    requiresDevice: 'hack_laptop',
    desc:'Remotely disables a homeowner security system for 30 minutes. Sets break-in defense to 0% and disables cameras. Follow up with /use break-in-kit immediately.',
  },
  // ── INTEL (builtin+) ──────────────────────────────────────
  keylogger: {
    name:'Keylogger', emoji:'⌨️', category:'intel',
    desc:'Shows your full stolen-SSN vault — every SSN you\'ve collected via Scanner or TOR buys. Use this to find the SSN number you need for Credit Cracker.',
  },
  stalker_app: {
    name:'Stalker App', emoji:'👁️', category:'intel', baseSuccess:60,
    desc:'Pulls a full dossier on any user — wallet, bank, home tier, business, gang, credit score, routing number, and debit card number.',
  },
  dark_search: {
    name:'DarkSearch', emoji:'🔍', category:'intel', baseSuccess:55,
    desc:'Searches the TOR dark web marketplace for active listings tied to a target user or routing number.',
  },
  tor_browser: {
    name:'TOR Browser', emoji:'🌐', category:'intel', baseSuccess:100,
    desc:'Passive — reduces TOR trace risk by 20% and provides TOR usage guide. Use /tor market to browse stolen identities.',
  },
  // ── DEFENSE (builtin+) ────────────────────────────────────
  vpn_shield: {
    name:'VPN Shield', emoji:'🛡️', category:'defense', bonusPct:30,
    desc:'Passive — routes all activity through encrypted tunnels. Reduces trace risk by 60% on TOR and hacks.',
  },
  // ── FINANCE (builtin+) ────────────────────────────────────
  bank_mirror: {
    name:'Bank Mirror', emoji:'🏦', category:'finance', baseSuccess:100,
    desc:'Read-only mirror of any bank account via routing number. Shows wallet, bank balance, and business revenue.',
  },
  launder_bot: {
    name:'LaunderBot', emoji:'🧺', category:'finance', bonusPct:15,
    desc:'Passive — upgrades your money laundering rate. Higher quality tiers increase clean rate up to 85%.',
  },
  // ── POLITICAL (requires political_laptop + Political Power faction) ──
  policy_intel: {
    name:'Policy Intel', emoji:'🏛️', category:'political', baseSuccess:100,
    requiresDevice: 'political_laptop',
    desc:'Classified access — view full server economy stats, all user wealth rankings, heat levels, and recent crime activity.',
  },
  voter_suppress: {
    name:'Voter Suppress', emoji:'🗳️', category:'political', baseSuccess:65,
    requiresDevice: 'political_laptop',
    desc:'Covertly suppress a target from earning daily/work income for 24 hours. Leaves no trace or evidence.',
  },
  blacksite_op: {
    name:'Blacksite Op', emoji:'🕵️', category:'political', baseSuccess:70,
    requiresDevice: 'political_laptop',
    desc:'Shadow rob a target with zero heat generated and zero evidence. Covert — 12% of their wallet, untraceable.',
  },
  classified_brief: {
    name:'Classified Brief', emoji:'📋', category:'political', baseSuccess:100,
    requiresDevice: 'political_laptop',
    desc:'Enhanced intelligence — full user profile plus all active effects, voodoo status, Illuminati standing, and dark web exposure history.',
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
  preloadLaptopCache, getLaptop, saveLaptop, hasApp,
  BUILTIN_APPS, DEVICE_TIERS, DEVICE_ORDER, getEffectiveSuccess,
};
