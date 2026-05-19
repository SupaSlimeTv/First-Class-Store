// ============================================================
// utils/familyDb.js — Family System
// BitLife-lite: life events, choices, stats, legacy
// ============================================================
const { col } = require('./mongo');

let _families = {};

const WEALTH_TIERS = [
  { id: 'struggling',   label: '💸 Struggling',    min: 0        },
  { id: 'middle',       label: '🏠 Middle Class',   min: 10000    },
  { id: 'comfortable',  label: '🏡 Comfortable',    min: 100000   },
  { id: 'wealthy',      label: '💎 Wealthy',         min: 500000   },
  { id: 'elite',        label: '👑 Elite',           min: 2000000  },
];

const CHILD_NAMES = [
  'Aiden','Sofia','Liam','Emma','Noah','Olivia','Mason','Ava',
  'Elijah','Isabella','James','Mia','Oliver','Charlotte','Benjamin',
  'Amelia','Lucas','Harper','Henry','Evelyn','Alexander','Luna',
  'Michael','Zoe','Ethan','Nora','Daniel','Lily','Logan','Eleanor',
];

const CHILD_TRAITS = ['ambitious','creative','rebellious','studious','charismatic','troubled'];

// ── EVENTS POOL ──────────────────────────────────────────────
// Outcome keys: wallet (fixed), walletLoss (%), walletRange [min,max],
//               happiness, reputation, legacy, divorce, addChild, dynasty
const EVENTS = [
  {
    id: 'inheritance',
    name: '💰 Unexpected Inheritance',
    description: 'A distant relative passed away and named you in their will. The estate is substantial.',
    choices: [
      { label: '💸 Take it all',         desc: 'Money is money.',    wallet: 75000,  happiness: 5,   reputation: -10, legacy: 5  },
      { label: '🤝 Split with siblings', desc: 'Generosity pays.',   wallet: 30000,  happiness: 15,  reputation: 15,  legacy: 15 },
    ],
  },
  {
    id: 'business_deal',
    name: '📊 Shady Business Offer',
    description: 'A mysterious investor offers you a deal with huge upside — and unknown downside.',
    choices: [
      { label: '✅ Take the gamble', desc: 'High risk, high reward.', walletRange: [-100000, 250000], legacy: 10 },
      { label: '❌ Walk away',       desc: 'Safety first.',           happiness: 5, reputation: 5          },
    ],
  },
  {
    id: 'scandal',
    name: '📸 Family Scandal',
    description: 'A tabloid is running a damaging story about your family.',
    choices: [
      { label: '💰 Pay to suppress it',  desc: 'Make it disappear.',    wallet: -50000, happiness: -5                       },
      { label: '🎤 Address it publicly', desc: 'Face the music head-on.', reputation: -20, happiness: -15, legacy: -5      },
    ],
  },
  {
    id: 'affair',
    name: '💔 Infidelity Discovered',
    description: 'You discover evidence your partner has been unfaithful.',
    requiresPartner: true,
    choices: [
      { label: '❤️‍🩹 Stay together',    desc: 'Work through it.',  happiness: -30, reputation: -10, legacy: 5  },
      { label: '⚡ File for divorce',  desc: 'Cut your losses.', happiness: -20, reputation: -5,  legacy: -15, divorce: true },
    ],
  },
  {
    id: 'new_baby',
    name: '👶 New Family Member',
    description: 'Your family is about to grow. A new life is on the way.',
    requiresPartner: true,
    maxChildren: 4,
    choices: [
      { label: '🎉 Welcome them',  desc: 'More the merrier.', happiness: 20, reputation: 10, legacy: 20, addChild: true },
      { label: '😰 Push through', desc: 'Life adjusts.',     happiness: -5, legacy: 5,                  addChild: true },
    ],
  },
  {
    id: 'kid_trouble',
    name: '🚔 Child in Legal Trouble',
    description: 'Your child has been arrested for a serious offense.',
    requiresChildren: true,
    choices: [
      { label: '💰 Hire the best lawyer', desc: 'Money fixes everything.',  wallet: -75000, happiness: -10, reputation: -5  },
      { label: '📞 Let them face it',     desc: 'Tough love.',              happiness: -25, reputation: -20, legacy: -15   },
    ],
  },
  {
    id: 'medical_emergency',
    name: '🏥 Medical Emergency',
    description: 'A family member needs urgent and expensive medical care.',
    choices: [
      { label: '💰 Spare no expense', desc: 'Best private care.',  wallet: -100000, happiness: 10,  legacy: 15 },
      { label: '🏥 Standard care',    desc: 'Do what you can.',    wallet: -20000,  happiness: -10             },
    ],
  },
  {
    id: 'school_achievement',
    name: '🎓 Academic Excellence',
    description: 'Your child received a full scholarship to a prestigious university.',
    requiresChildren: true,
    choices: [
      { label: '🎉 Throw a celebration', desc: 'Celebrate publicly.',  wallet: -10000, happiness: 25, reputation: 20, legacy: 30 },
      { label: '🤫 Stay humble',         desc: 'Keep it private.',     happiness: 15,  legacy: 15                                },
    ],
  },
  {
    id: 'charity_gala',
    name: '🥂 Elite Charity Gala',
    description: 'A high-profile gala is requesting your attendance and a significant donation.',
    choices: [
      { label: '💎 Attend and donate big', desc: 'Make an impression.',   wallet: -100000, reputation: 30, happiness: 15, legacy: 20 },
      { label: '📬 Send a check',          desc: 'Show face on a budget.', wallet: -30000, reputation: 10, happiness: 5             },
    ],
  },
  {
    id: 'property_dispute',
    name: '⚖️ Family Property Dispute',
    description: 'A relative is legally contesting ownership of family property.',
    choices: [
      { label: '⚖️ Fight in court',    desc: 'Defend your claim.',    wallet: -60000, happiness: -15, reputation: 10 },
      { label: '🤝 Settle peacefully', desc: 'Split the difference.', wallet: -25000, happiness: 5                  },
    ],
  },
  {
    id: 'family_vacation',
    name: '✈️ Family Vacation',
    description: 'An opportunity to take your family somewhere truly special.',
    choices: [
      { label: '🌴 Five-star resort', desc: 'Only the best.',        wallet: -50000, happiness: 30, legacy: 10 },
      { label: '🏕️ Modest getaway',  desc: 'Quality time matters.', wallet: -10000, happiness: 20, legacy: 5  },
    ],
  },
  {
    id: 'addiction',
    name: '💊 Family Member in Crisis',
    description: 'Someone close to you is struggling with addiction and needs help.',
    choices: [
      { label: '🏥 Private rehabilitation', desc: 'Get them the best help.', wallet: -75000, happiness: -5,  reputation: 5,  legacy: 20 },
      { label: '😔 Hope for the best',      desc: 'Stay out of it.',         happiness: -30, reputation: -15, legacy: -20              },
    ],
  },
  {
    id: 'rival_family',
    name: '⚔️ Family Rivalry',
    description: 'A rival family has been actively sabotaging your reputation in public.',
    choices: [
      { label: '🔥 Strike back hard', desc: 'Show no weakness.', wallet: -30000, happiness: -5, reputation: 5,  legacy: 15 },
      { label: '🕊️ Make peace',       desc: 'End the feud.',     happiness: 10,  reputation: 15, legacy: 5                },
    ],
  },
  {
    id: 'investment_loss',
    name: '📉 Investment Disaster',
    description: 'A trusted investment has collapsed, taking a chunk of your wealth with it.',
    choices: [
      { label: '💸 Cut your losses',  desc: 'Liquidate and move on.',      walletLoss: 0.12, happiness: -20             },
      { label: '📊 Double down',      desc: 'Bet on the recovery.',        walletRange: [-150000, 400000], happiness: -10 },
    ],
  },
  {
    id: 'political_offer',
    name: '🏛️ Political Appointment',
    description: 'A powerful political figure wants to appoint a family member to a prestigious position.',
    choices: [
      { label: '✅ Accept the role', desc: 'Public service awaits.',  reputation: 30, happiness: 10, legacy: 35 },
      { label: '❌ Stay private',    desc: 'Keep a low profile.',     happiness: 5,   legacy: 5                 },
    ],
  },
  // ── ILLUMINATI-EXCLUSIVE EVENTS ────────────────────────────
  {
    id: 'dynasty_contract',
    name: '⛓️ Dynasty Contract',
    description: 'The Illuminati offers your family a dynasty contract — power and protection across generations.',
    illuminatiOnly: true,
    choices: [
      { label: '✍️ Sign the contract',  desc: 'Bind your bloodline.',     legacy: 100, happiness: 15, reputation: 20, dynasty: true },
      { label: '❌ Decline the offer',  desc: 'Keep your independence.',  happiness: -5, reputation: -5                             },
    ],
  },
  {
    id: 'arranged_alliance',
    name: '💍 Illuminati Arranged Alliance',
    description: 'The order has arranged a marriage alliance with an elite family. The wealth transfer would be significant.',
    illuminatiOnly: true,
    choices: [
      { label: '💍 Accept the alliance',    desc: 'Power through union.',  happiness: 5, reputation: 30, legacy: 50, wallet: 200000 },
      { label: '❌ Refuse the arrangement', desc: 'Love over politics.',   happiness: 10, reputation: -20, legacy: -10             },
    ],
  },
  {
    id: 'shadow_threat',
    name: '⚠️ Rival Faction Targeting Your Family',
    description: 'A rival Illuminati faction has marked your family for intimidation and interference.',
    illuminatiOnly: true,
    choices: [
      { label: '💰 Pay for protection',           desc: 'Buy safety.',             wallet: -100000, happiness: -5                 },
      { label: '⚔️ Fight back through the order', desc: 'Use the order\'s power.', happiness: -15,  reputation: 5, legacy: 20    },
    ],
  },
  {
    id: 'illuminati_blessing',
    name: '🔺 Illuminati Family Blessing',
    description: 'The order has sent resources and goodwill to your household.',
    illuminatiOnly: true,
    choices: [
      { label: '🙏 Accept graciously', desc: 'The order provides.',  wallet: 50000,  happiness: 20, reputation: 10, legacy: 10 },
      { label: '💎 Push for more',     desc: 'Test your influence.', wallet: 100000, happiness: 10, reputation: -5, legacy: 5  },
    ],
  },
];

// ── DB FUNCTIONS ─────────────────────────────────────────────
async function preloadFamilyCache() {
  try {
    const c    = await col('families');
    const docs = await c.find({}).toArray();
    for (const d of docs) {
      const id = d._id;
      const o  = { ...d };
      delete o._id;
      _families[id] = o;
    }
    console.log(`👨‍👩‍👧 Family cache loaded (${Object.keys(_families).length} families)`);
  } catch (e) { console.error('preloadFamilyCache error:', e.message); }
}

function getFamily(userId) {
  return _families[userId] || null;
}

async function saveFamily(userId, data) {
  _families[userId] = data;
  try {
    const c = await col('families');
    await c.replaceOne({ _id: userId }, { _id: userId, ...data }, { upsert: true });
  } catch (e) { console.error('saveFamily error:', e.message); }
}

function createFamily(userId, partnerName) {
  return {
    userId,
    partner:    { name: partnerName, marriedAt: Date.now() },
    children:   [],
    happiness:  70,
    legacy:     0,
    reputation: 50,
    events:     [],
    eventCount: 0,
    lastEvent:  null,
    dynasty:    false,
    heir:       null,
    createdAt:  Date.now(),
  };
}

// ── HELPERS ──────────────────────────────────────────────────
function getWealthTier(totalWealth) {
  let tier = WEALTH_TIERS[0];
  for (const t of WEALTH_TIERS) {
    if (totalWealth >= t.min) tier = t;
  }
  return tier;
}

function generateChild(eventCount) {
  return {
    name:        CHILD_NAMES[Math.floor(Math.random() * CHILD_NAMES.length)],
    trait:       CHILD_TRAITS[Math.floor(Math.random() * CHILD_TRAITS.length)],
    bornAtEvent: eventCount,
  };
}

function getChildAge(child, currentEventCount) {
  const n = currentEventCount - (child.bornAtEvent || 0);
  if (n < 2)  return 'newborn';
  if (n < 5)  return 'young child';
  if (n < 10) return 'preteen';
  if (n < 18) return 'teenager';
  return 'adult';
}

function happinessBar(happiness) {
  const filled = Math.round(Math.max(0, Math.min(100, happiness)) / 10);
  return '🟨'.repeat(filled) + '⬛'.repeat(10 - filled);
}

module.exports = {
  preloadFamilyCache,
  getFamily, saveFamily, createFamily,
  getWealthTier, generateChild, getChildAge, happinessBar,
  WEALTH_TIERS, EVENTS, CHILD_NAMES, CHILD_TRAITS,
};
