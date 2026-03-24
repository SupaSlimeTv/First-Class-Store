// ============================================================
// utils/phoneDb.js — Phone, Influencer & Status System
// ============================================================
const { col } = require('./mongo');

let _phones = {};

async function preloadPhoneCache() {
  try {
    const c    = await col('phones');
    const docs = await c.find({}).toArray();
    _phones = Object.fromEntries(docs.map(d => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    console.log(`📱 Phone cache loaded (${Object.keys(_phones).length} phones)`);
  } catch(e) { console.error('preloadPhoneCache error:', e.message); }
}

function getPhone(userId)  { return _phones[userId] || null; }
function getAllPhones()     { return { ..._phones }; }

async function savePhone(userId, data) {
  _phones[userId] = data;
  try {
    const c = await col('phones');
    await c.replaceOne({ _id: userId }, { _id: userId, ...data }, { upsert: true });
  } catch(e) { console.error('savePhone error:', e.message); }
}

// ── INFLUENCER STATUS TIERS ───────────────────────────────
// Status is gained by posting consistently across platforms
// Each status tier multiplies ALL earnings/hype/influence
const STATUS_TIERS = [
  { id:'nobody',     label:'📵 Nobody',         minStatus:0,     fanCount:0,       mult:1.0,  sponsorSlots:0, coinHypeMult:0.1,  color:0x888888 },
  { id:'newcomer',   label:'🌱 Newcomer',        minStatus:100,   fanCount:50,      mult:1.2,  sponsorSlots:1, coinHypeMult:0.3,  color:0x2ecc71 },
  { id:'creator',    label:'📱 Content Creator', minStatus:500,   fanCount:250,     mult:1.5,  sponsorSlots:2, coinHypeMult:0.6,  color:0x3498db },
  { id:'influencer', label:'🔥 Influencer',      minStatus:2000,  fanCount:1000,    mult:2.0,  sponsorSlots:3, coinHypeMult:1.0,  color:0xf5c518 },
  { id:'celebrity',  label:'⭐ Celebrity',        minStatus:8000,  fanCount:10000,   mult:3.0,  sponsorSlots:4, coinHypeMult:2.5,  color:0xff6b35 },
  { id:'superstar',  label:'💎 Superstar',        minStatus:25000, fanCount:100000,  mult:5.0,  sponsorSlots:5, coinHypeMult:5.0,  color:0xff3b3b },
  { id:'icon',       label:'👑 Cultural Icon',    minStatus:100000,fanCount:1000000, mult:10.0, sponsorSlots:6, coinHypeMult:15.0, color:0x9b59b6 },
];


// ── ARTIST CAREER TIERS ──────────────────────────────────────
// Separate hierarchy for music artists — tracked via phone.artistCareer
// Requires being signed to a label OR having music-related status
const ARTIST_TIERS = [
  { id:'unsigned',     label:'🎙️ Unsigned',          minFame:0,     revMult:1.0,  labelCut:30, perks:[] },
  { id:'local_buzz',   label:'🌆 Local Buzz',         minFame:500,   revMult:1.3,  labelCut:30, perks:['streetCred'] },
  { id:'indie_artist', label:'🎵 Indie Artist',        minFame:2000,  revMult:1.7,  labelCut:28, perks:['streetCred','collectibles'] },
  { id:'rising_star',  label:'📻 Rising Star',         minFame:8000,  revMult:2.2,  labelCut:25, perks:['streetCred','collectibles','radioPlay'] },
  { id:'mainstream',   label:'🎤 Mainstream Artist',   minFame:25000, revMult:3.0,  labelCut:22, perks:['streetCred','collectibles','radioPlay','brandDeals'] },
  { id:'platinum',     label:'🏆 Platinum Artist',     minFame:75000, revMult:4.5,  labelCut:18, perks:['streetCred','collectibles','radioPlay','brandDeals','tourRevenue'] },
  { id:'legend',       label:'👑 Music Legend',        minFame:200000,revMult:8.0,  labelCut:15, perks:['streetCred','collectibles','radioPlay','brandDeals','tourRevenue','legacy'] },
];

// Industry plant = boosted artist with artificially inflated stats
// iPlant flag gives 2x revenue but marks them as suspicious — can be exposed
const INDUSTRY_PLANT_MULT = 2.5;

function getArtistTier(fame) {
  return [...ARTIST_TIERS].reverse().find(t => fame >= t.minFame) || ARTIST_TIERS[0];
}

function getNextArtistTier(fame) {
  return ARTIST_TIERS.find(t => t.minFame > fame) || null;
}

function getStatusTier(status) {
  return [...STATUS_TIERS].reverse().find(t => status >= t.minStatus) || STATUS_TIERS[0];
}

function getNextStatusTier(status) {
  return STATUS_TIERS.find(t => t.minStatus > status) || null;
}

// Status gained per post = platform.statusGain * phone hype bonus
// Status is separate from influence (influence = 0-100 per-platform score)

// ── PLATFORM DEFINITIONS ──────────────────────────────────
const PLATFORMS = {
  flexgram: {
    name:'Flexgram', emoji:'📸', desc:'Photo & lifestyle. Big for brand deals.',
    cooldownMs: 45 * 60 * 1000,
    baseHype:15, baseMoney:200, statusGain:8,
    sponsorThreshold:5000,
  },
  chirp: {
    name:'Chirp', emoji:'🐦', desc:'Short takes. Hot takes. Going viral.',
    cooldownMs: 20 * 60 * 1000,
    baseHype:8, baseMoney:80, statusGain:3,
    sponsorThreshold:3000,
  },
  streamz: {
    name:'Streamz', emoji:'🎮', desc:'Live streams. Subs. Donations.',
    cooldownMs: 90 * 60 * 1000,
    baseHype:30, baseMoney:500, statusGain:20,
    sponsorThreshold:8000,
  },
};

// ── PHONE TIERS ───────────────────────────────────────────
const PHONE_TYPES = {
  burner:   { name:'Burner Phone',   emoji:'📵', cost:500,   hypeBonus:0,    moneyBonus:0,    statusBonus:0,    desc:'Barely works. Does the job.' },
  standard: { name:'Standard Phone', emoji:'📱', cost:2000,  hypeBonus:0.10, moneyBonus:0.10, statusBonus:0.10, desc:'Decent phone. Gets the job done.' },
  flagship: { name:'Flagship Phone', emoji:'📲', cost:8000,  hypeBonus:0.25, moneyBonus:0.25, statusBonus:0.25, desc:'Top of the line. Influencers only.' },
  creator:  { name:'Creator Pro',    emoji:'🎙️', cost:20000, hypeBonus:0.50, moneyBonus:0.50, statusBonus:0.50, desc:'Built for content creators. Goes viral easier.' },
};

// ── SPONSOR DEAL TEMPLATES by status tier ─────────────────
const SPONSOR_DEALS = {
  newcomer:   [{ name:'💊 Vitamin Brand', payout:500,   duration:3 },{ name:'👟 Local Gear Shop', payout:800, duration:3 }],
  creator:    [{ name:'🎮 Gaming Chair',  payout:2000,  duration:5 },{ name:'📱 App Sponsor',      payout:3000, duration:5 }],
  influencer: [{ name:'🚗 Car Brand',     payout:8000,  duration:7 },{ name:'💄 Beauty Brand',     payout:6000, duration:7 }],
  celebrity:  [{ name:'✈️ Airline Deal',  payout:25000, duration:10},{ name:'🏨 Hotel Chain',      payout:20000,duration:10}],
  superstar:  [{ name:'📺 TV Network',    payout:80000, duration:14},{ name:'🥤 Beverage Empire',  payout:100000,duration:14}],
  icon:       [{ name:'🌍 Global Brand',  payout:500000,duration:30},{ name:'🏆 Legacy Deal',      payout:1000000,duration:30}],
};

// ── DEFAULT DATA ──────────────────────────────────────────
function defaultPhone(phoneType) {
  return {
    type:         phoneType,
    status:       0,          // overall influencer status score
    followers:    0,          // total followers across all platforms
    influence:    0,          // 0-100 influence score
    hype:         0,          // total hype accumulated
    sponsorDeals: [],
    lastPost:     {},
    totalPosts:   0,
    totalEarned:  0,
    callCooldown: null,
    streak:       0,          // consecutive days posted (bonus multiplier)
    lastStreakDay: null,
  };
}

module.exports = {
  ARTIST_TIERS, getArtistTier, getNextArtistTier, INDUSTRY_PLANT_MULT,
  preloadPhoneCache, getPhone, savePhone, getAllPhones,
  STATUS_TIERS, getStatusTier, getNextStatusTier,
  PLATFORMS, PHONE_TYPES, SPONSOR_DEALS, defaultPhone,
};
