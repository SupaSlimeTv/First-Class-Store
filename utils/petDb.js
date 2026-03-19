// ============================================================
// utils/petDb.js — Pet System Database
// ============================================================
const fs   = require('fs');
const path = require('path');
const PET_FILE = path.join(__dirname, '../data/pets.json');

function readPets()    { try { return fs.existsSync(PET_FILE) ? JSON.parse(fs.readFileSync(PET_FILE,'utf8')) : {}; } catch { return {}; } }
function writePets(d)  { fs.writeFileSync(PET_FILE, JSON.stringify(d, null, 2)); }

function getPet(userId)       { return readPets()[userId] || null; }
function savePet(userId, pet) { const all = readPets(); all[userId] = pet; writePets(all); }
function deletePet(userId)    { const all = readPets(); delete all[userId]; writePets(all); }
function getAllPets()          { return readPets(); }

// ============================================================
// PET DEFINITIONS — ordered from weakest to most powerful
// ============================================================
const PET_TYPES = {
  hamster: {
    name: 'Hamster',        emoji: '🐹', tier: 1,
    cost: 500,              rarity: 'Common',
    baseHp: 30,             basePower: 2,   baseDefense: 1,
    hungerDrain: 5,         happinessDrain: 3,
    evolvesTo: 'rabbit',    evolveLevel: 5,
    desc: 'Tiny, harmless, and somehow adorable. Don\'t let it bite you.',
    abilities: ['nibble'],
    attackFlavor: ['scurried toward', 'threw seeds at', 'squeaked menacingly at'],
  },
  rabbit: {
    name: 'Rabbit',         emoji: '🐰', tier: 2,
    cost: 1500,             rarity: 'Common',
    baseHp: 55,             basePower: 6,   baseDefense: 3,
    hungerDrain: 6,         happinessDrain: 4,
    evolvesTo: 'wolf',      evolveLevel: 10,
    desc: 'Faster than you think. Those teeth are for more than carrots.',
    abilities: ['scratch', 'thump'],
    attackFlavor: ['hopped at', 'kicked', 'bit'],
  },
  wolf: {
    name: 'Wolf',           emoji: '🐺', tier: 3,
    cost: 5000,             rarity: 'Uncommon',
    baseHp: 100,            basePower: 18,  baseDefense: 8,
    hungerDrain: 8,         happinessDrain: 5,
    evolvesTo: 'bear',      evolveLevel: 15,
    desc: 'Loyal to their owner. Territorial with everyone else.',
    abilities: ['howl', 'bite', 'pack_call'],
    attackFlavor: ['lunged at', 'snarled and charged', 'pinned down'],
  },
  bear: {
    name: 'Grizzly Bear',   emoji: '🐻', tier: 4,
    cost: 12000,            rarity: 'Uncommon',
    baseHp: 180,            basePower: 35,  baseDefense: 20,
    hungerDrain: 10,        happinessDrain: 5,
    evolvesTo: 'kraken',    evolveLevel: 20,
    desc: 'Nobody messes with the bear owner. Nobody.',
    abilities: ['maul', 'roar', 'hibernate_heal'],
    attackFlavor: ['mauled', 'body-slammed', 'swiped at'],
  },
  kraken: {
    name: 'Kraken',         emoji: '🦑', tier: 5,
    cost: 30000,            rarity: 'Rare',
    baseHp: 300,            basePower: 60,  baseDefense: 35,
    hungerDrain: 12,        happinessDrain: 6,
    evolvesTo: 'basilisk',  evolveLevel: 25,
    desc: 'From the deep. Tentacles reach farther than you\'d expect.',
    abilities: ['ink_spray', 'tentacle_grab', 'tidal_wave'],
    attackFlavor: ['wrapped tentacles around', 'dragged under', 'crushed'],
  },
  basilisk: {
    name: 'Basilisk',       emoji: '🐍', tier: 6,
    cost: 60000,            rarity: 'Rare',
    baseHp: 420,            basePower: 90,  baseDefense: 50,
    hungerDrain: 14,        happinessDrain: 7,
    evolvesTo: 'phoenix',   evolveLevel: 30,
    desc: 'Ancient. Venomous. One look and you\'re done.',
    abilities: ['petrify', 'venom_strike', 'stone_gaze'],
    attackFlavor: ['petrified', 'bit and venomized', 'stared down'],
  },
  phoenix: {
    name: 'Phoenix',        emoji: '🔥', tier: 7,
    cost: 120000,           rarity: 'Epic',
    baseHp: 600,            basePower: 130, baseDefense: 70,
    hungerDrain: 16,        happinessDrain: 8,
    evolvesTo: 'leviathan', evolveLevel: 35,
    desc: 'Dies and comes back. Your enemies won\'t.',
    abilities: ['flame_burst', 'rebirth', 'inferno'],
    attackFlavor: ['scorched', 'incinerated', 'unleashed hellfire on'],
  },
  leviathan: {
    name: 'Leviathan',      emoji: '🌊', tier: 8,
    cost: 250000,           rarity: 'Epic',
    baseHp: 900,            basePower: 200, baseDefense: 110,
    hungerDrain: 18,        happinessDrain: 9,
    evolvesTo: 'dragon',    evolveLevel: 40,
    desc: 'Sea serpent the size of a city. Apocalyptic vibes only.',
    abilities: ['tidal_crush', 'sea_terror', 'world_flood'],
    attackFlavor: ['tsunami\'d', 'swallowed', 'obliterated'],
  },
  dragon: {
    name: 'Dragon',         emoji: '🐉', tier: 9,
    cost: 500000,           rarity: 'Legendary',
    baseHp: 1400,           basePower: 320, baseDefense: 180,
    hungerDrain: 20,        happinessDrain: 10,
    evolvesTo: 'world_serpent', evolveLevel: 50,
    desc: 'Hoarder of wealth. Destroyer of anyone who threatens its owner.',
    abilities: ['dragon_breath', 'wing_slam', 'hoard_passive', 'terror'],
    attackFlavor: ['breathed fire on', 'crushed under its claw', 'annihilated'],
  },
  world_serpent: {
    name: 'World Serpent',  emoji: '🐲', tier: 10,
    cost: 1000000,          rarity: 'Mythic',
    baseHp: 2500,           basePower: 600, baseDefense: 350,
    hungerDrain: 25,        happinessDrain: 12,
    evolvesTo: null,        evolveLevel: null,
    desc: 'Jörmungandr. Coils around the world itself. Endgame.',
    abilities: ['world_coil', 'void_bite', 'apocalypse', 'passive_terror'],
    attackFlavor: ['coiled around the world and crushed', 'ended', 'erased from existence'],
  },
};

// Stat calculation based on level
function calcPetStats(pet) {
  const base  = PET_TYPES[pet.type];
  const level = pet.level || 1;
  const bond  = (pet.bond || 0) / 100;
  return {
    hp:      Math.floor(base.baseHp      * (1 + (level - 1) * 0.15) * (1 + bond * 0.2)),
    power:   Math.floor(base.basePower   * (1 + (level - 1) * 0.12) * (1 + bond * 0.3)),
    defense: Math.floor(base.baseDefense * (1 + (level - 1) * 0.10) * (1 + bond * 0.15)),
  };
}

// XP needed for next level
function xpForLevel(level) { return Math.floor(100 * Math.pow(level, 1.5)); }

module.exports = { getPet, savePet, deletePet, getAllPets, PET_TYPES, calcPetStats, xpForLevel };
