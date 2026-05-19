// ============================================================
// utils/lifePathDb.js — Life Path & Born-At System
// Tracks each user's chosen origin, bonuses, and age.
// ============================================================
const { col } = require('./mongo');

let _paths = {}; // userId -> lifePathData

// ── PATH DEFINITIONS ──────────────────────────────────────────
const LIFE_PATHS = {
  street_hustler: {
    id:    'street_hustler',
    name:  'Street Hustler',
    emoji: '🔥',
    description: 'Started with nothing. Crime is your ladder to the top.',
    flavor: 'You grew up scrapping for every dollar. The streets taught you everything.',
    bonuses: {
      robBonus:   0.12,  // +12% rob success chance
      crimeBonus: 0.15,  // +15% crime/hack income
      drugBonus:  0.10,  // +10% drug deal profit
    },
    bonusText: [
      '+12% rob success chance',
      '+15% crime & hack income',
      '+10% drug deal profit',
    ],
    illuminatiEligible: ['freemason_lodge'],
    startingBonus: 250,
    color: 0xe74c3c,
  },
  entrepreneur: {
    id:    'entrepreneur',
    name:  'Entrepreneur',
    emoji: '💼',
    description: 'Built for business. Wealth compounds in your hands.',
    flavor: 'You saw opportunity where others saw chaos. Money works for you.',
    bonuses: {
      bizRevenueBonus: 0.20, // +20% business collect revenue
      investBonus:     0.10, // +10% investment returns
      dailyBonus:      0.15, // +15% daily payout
    },
    bonusText: [
      '+20% business revenue',
      '+10% investment returns',
      '+15% daily payout',
    ],
    illuminatiEligible: ['old_blood_elite', 'freemason_lodge'],
    startingBonus: 500,
    color: 0x27ae60,
  },
  entertainer: {
    id:    'entertainer',
    name:  'Entertainer',
    emoji: '🎤',
    description: 'Fame is your currency. The spotlight follows you.',
    flavor: 'You were born to perform. Every room you enter becomes your stage.',
    bonuses: {
      labelBonus:   0.25, // +25% music label earnings
      sponsorBonus: 0.20, // +20% sponsor deal payouts
      dailyBonus:   0.10, // +10% daily payout
    },
    bonusText: [
      '+25% music label earnings',
      '+20% sponsor deal payouts',
      '+10% daily payout',
    ],
    illuminatiEligible: ['hollywood_cabal'],
    startingBonus: 300,
    color: 0x9b59b6,
  },
  politician: {
    id:    'politician',
    name:  'Politician',
    emoji: '🏛️',
    description: 'Power moves quietly. Influence is everything.',
    flavor: 'You learned early that perception is power. Words are your weapons.',
    bonuses: {
      heatDecayBonus: 0.25, // +25% heat decay per cycle
      bribeBonus:     0.20, // +20% bribe/police effectiveness
      robBonus:       0.05, // +5% rob success (connections)
    },
    bonusText: [
      '+25% faster heat decay',
      '+20% bribe effectiveness',
      '+5% rob success (connections)',
    ],
    illuminatiEligible: ['freemason_lodge', 'old_blood_elite'],
    startingBonus: 400,
    color: 0x2980b9,
  },
};

// ── CACHE OPS ─────────────────────────────────────────────────
async function preloadLifePathCache() {
  try {
    const c    = await col('lifepaths');
    const docs = await c.find({}).toArray();
    _paths = Object.fromEntries(docs.map(d => {
      const id = d._id; const o = { ...d }; delete o._id; return [id, o];
    }));
    console.log(`🌱 Life path cache loaded (${Object.keys(_paths).length} users)`);
  } catch(e) { console.error('preloadLifePathCache error:', e.message); }
}

function getLifePath(userId) { return _paths[userId] || null; }

function saveLifePath(userId, data) {
  _paths[userId] = data;
  col('lifepaths').then(c => c.replaceOne(
    { _id: userId }, { _id: userId, ...data }, { upsert: true }
  )).catch(e => console.error('saveLifePath error:', e.message));
}

function createLifePath(userId, pathId) {
  const lp = { userId, path: pathId, chosenAt: Date.now(), bornAt: _paths[userId]?.bornAt || Date.now() };
  saveLifePath(userId, lp);
  return lp;
}

// Called when an account is first opened — sets the birth timestamp
function setBornAt(userId) {
  if (_paths[userId]) {
    if (!_paths[userId].bornAt) {
      _paths[userId].bornAt = Date.now();
      saveLifePath(userId, _paths[userId]);
    }
    return;
  }
  const lp = { userId, path: null, bornAt: Date.now(), chosenAt: null };
  saveLifePath(userId, lp);
}

// ── BONUS HELPERS ─────────────────────────────────────────────
function getPathBonus(userId, bonusKey) {
  const lp = _paths[userId];
  if (!lp?.path) return 0;
  return LIFE_PATHS[lp.path]?.bonuses[bonusKey] || 0;
}

// ── DISPLAY HELPERS ───────────────────────────────────────────
function getAgeString(bornAt) {
  if (!bornAt) return 'Unknown';
  const ms   = Date.now() - bornAt;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1)  return 'Just born';
  if (days < 7)  return `${days} day${days !== 1 ? 's' : ''} old`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks !== 1 ? 's' : ''} old`;
  const months = Math.floor(days / 30);
  if (months < 13) return `${months} month${months !== 1 ? 's' : ''} old`;
  const years = Math.floor(days / 365);
  const rem   = Math.floor((days % 365) / 30);
  return rem > 0 ? `${years}y ${rem}mo old` : `${years} year${years !== 1 ? 's' : ''} old`;
}

// Returns days since account was born, or null if bornAt is not set (grandfathered accounts)
function getAccountAgeDays(userId) {
  const lp = _paths[userId];
  if (!lp?.bornAt) return null;
  return Math.floor((Date.now() - lp.bornAt) / (1000 * 60 * 60 * 24));
}

module.exports = {
  preloadLifePathCache, getLifePath, saveLifePath, createLifePath, setBornAt,
  getPathBonus, getAgeString, getAccountAgeDays, LIFE_PATHS,
};
