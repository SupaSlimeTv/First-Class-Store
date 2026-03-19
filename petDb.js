// ============================================================
// utils/petDb.js — Pet System Database
// Stores pet data in data/pets.json
// ============================================================

const fs   = require('fs');
const path = require('path');

const PETS_FILE = path.join(__dirname, '../data/pets.json');

function readPets() {
  try { return fs.existsSync(PETS_FILE) ? JSON.parse(fs.readFileSync(PETS_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function savePets(data) { fs.writeFileSync(PETS_FILE, JSON.stringify(data, null, 2)); }

function getPet(userId)      { return readPets()[userId] || null; }
function savePet(userId, pet){ const all = readPets(); all[userId] = pet; savePets(all); }
function deletePet(userId)   { const all = readPets(); delete all[userId]; savePets(all); }
function getAllPets()         { return readPets(); }

// ============================================================
// PET TYPES — define all available pets
// tier: 1-10 (affects color and power)
// rarity: Common, Uncommon, Rare, Epic, Legendary, Mythic
// ============================================================
const PET_TYPES = {
  dog: {
    name: 'Dog',
    emoji: '🐕',
    desc: 'Man\'s best friend. Loyal, protective, and always happy to see you.',
    cost: 500,
    rarity: 'Common',
    tier: 1,
    basePower: 5,
    baseDefense: 3,
    baseHp: 50,
    abilities: ['bark', 'fetch'],
    evolvesTo: 'wolf',
    evolveLevel: 10,
  },
  cat: {
    name: 'Cat',
    emoji: '🐈',
    desc: 'Mysterious and independent. Brings luck and occasionally knocks things off shelves.',
    cost: 500,
    rarity: 'Common',
    tier: 1,
    basePower: 4,
    baseDefense: 4,
    baseHp: 45,
    abilities: ['scratch', 'stealth'],
    evolvesTo: 'panther',
    evolveLevel: 10,
  },
  rabbit: {
    name: 'Rabbit',
    emoji: '🐇',
    desc: 'Fast and lucky. Boosts your daily earnings when well-fed.',
    cost: 750,
    rarity: 'Common',
    tier: 1,
    basePower: 3,
    baseDefense: 2,
    baseHp: 35,
    abilities: ['luck_boost', 'dash'],
    evolvesTo: null,
    evolveLevel: null,
  },
  wolf: {
    name: 'Wolf',
    emoji: '🐺',
    desc: 'Fierce and relentless. Commands fear and fights with pack instinct.',
    cost: 3000,
    rarity: 'Uncommon',
    tier: 3,
    basePower: 18,
    baseDefense: 10,
    baseHp: 120,
    abilities: ['howl', 'pack_strike', 'intimidate'],
    evolvesTo: 'direwolf',
    evolveLevel: 20,
  },
  panther: {
    name: 'Panther',
    emoji: '🐆',
    desc: 'Silent predator. Specializes in ambushes and critical strikes.',
    cost: 3000,
    rarity: 'Uncommon',
    tier: 3,
    basePower: 20,
    baseDefense: 8,
    baseHp: 100,
    abilities: ['ambush', 'shadow_strike', 'stealth'],
    evolvesTo: null,
    evolveLevel: null,
  },
  bear: {
    name: 'Bear',
    emoji: '🐻',
    desc: 'Massive and unstoppable. Built for defense and overpowering attacks.',
    cost: 4000,
    rarity: 'Rare',
    tier: 5,
    basePower: 25,
    baseDefense: 20,
    baseHp: 200,
    abilities: ['slam', 'roar', 'fortify'],
    evolvesTo: 'polar_bear',
    evolveLevel: 25,
  },
  eagle: {
    name: 'Eagle',
    emoji: '🦅',
    desc: 'Eyes like a hawk, strikes like lightning. High speed aerial attacker.',
    cost: 5000,
    rarity: 'Rare',
    tier: 5,
    basePower: 30,
    baseDefense: 12,
    baseHp: 110,
    abilities: ['dive_bomb', 'talon_strike', 'scout'],
    evolvesTo: null,
    evolveLevel: null,
  },
  dragon: {
    name: 'Dragon',
    emoji: '🐉',
    desc: 'Ancient and devastating. The pinnacle of power and prestige.',
    cost: 25000,
    rarity: 'Legendary',
    tier: 9,
    basePower: 80,
    baseDefense: 60,
    baseHp: 500,
    abilities: ['fire_breath', 'dragon_claw', 'intimidate', 'fortify'],
    evolvesTo: null,
    evolveLevel: null,
  },
  phoenix: {
    name: 'Phoenix',
    emoji: '🦅',
    desc: 'Born from flame and reborn from ash. Mythical protector that defies defeat.',
    cost: 50000,
    rarity: 'Mythic',
    tier: 10,
    basePower: 100,
    baseDefense: 80,
    baseHp: 750,
    abilities: ['inferno', 'rebirth', 'solar_beam', 'healing_flame'],
    evolvesTo: null,
    evolveLevel: null,
  },
  direwolf: {
    name: 'Direwolf',
    emoji: '🐺',
    desc: 'The apex predator. Evolved from loyalty and battle-forged.',
    cost: 15000,
    rarity: 'Epic',
    tier: 7,
    basePower: 55,
    baseDefense: 35,
    baseHp: 320,
    abilities: ['frenzy', 'pack_strike', 'howl', 'intimidate'],
    evolvesTo: null,
    evolveLevel: null,
  },
  polar_bear: {
    name: 'Polar Bear',
    emoji: '🐻‍❄️',
    desc: 'The ultimate tank. Near-unbreakable defense with devastating power.',
    cost: 20000,
    rarity: 'Epic',
    tier: 7,
    basePower: 50,
    baseDefense: 55,
    baseHp: 450,
    abilities: ['blizzard_slam', 'fortify', 'roar', 'frost_aura'],
    evolvesTo: null,
    evolveLevel: null,
  },
};

// ============================================================
// STAT CALCULATOR
// Stats scale with level and bond
// ============================================================
function calcPetStats({ type, level, bond }) {
  const pet = PET_TYPES[type];
  if (!pet) return { power: 0, defense: 0, hp: 0 };

  const lvlMult  = 1 + (level - 1) * 0.12;   // +12% per level
  const bondMult = 1 + (bond  / 100) * 0.25;  // up to +25% from bond

  return {
    power:   Math.floor(pet.basePower   * lvlMult * bondMult),
    defense: Math.floor(pet.baseDefense * lvlMult * bondMult),
    hp:      Math.floor(pet.baseHp      * lvlMult * bondMult),
  };
}

module.exports = { getPet, savePet, deletePet, getAllPets, PET_TYPES, calcPetStats };
