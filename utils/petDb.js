// ============================================================
// utils/petDb.js — Pet System Database (MongoDB)
// ============================================================
const { col } = require('./mongo');

// In-memory cache
let _pets = {};

async function preloadPetCache() {
  try {
    const c    = await col('pets');
    const docs = await c.find({}).toArray();
    _pets = Object.fromEntries(docs.map(d => { const id=d._id; const o={...d}; delete o._id; return [id,o]; }));
    console.log(`📦 Pet cache loaded (${Object.keys(_pets).length} pets)`);
  } catch(e) { console.error('preloadPetCache error:', e.message); }
}

function getPet(userId)    { return _pets[userId] || null; }
function getAllPets()       { return { ..._pets }; }

async function savePet(userId, pet) {
  _pets[userId] = pet;
  try {
    const c = await col('pets');
    await c.replaceOne({ _id: userId }, { _id: userId, ...pet }, { upsert: true });
  } catch(e) { console.error('savePet error:', e.message); }
}

async function deletePet(userId) {
  delete _pets[userId];
  try {
    const c = await col('pets');
    await c.deleteOne({ _id: userId });
  } catch(e) { console.error('deletePet error:', e.message); }
}

// ============================================================
// PET DEFINITIONS
// ============================================================
const PET_TYPES = {
  hamster:      { name:'Hamster',       emoji:'🐹', tier:1,  cost:500,     rarity:'Common',    baseHp:30,   basePower:2,   baseDefense:1,   hungerDrain:5,  happinessDrain:3,  evolvesTo:'rabbit',       evolveLevel:5,  desc:"Tiny, harmless, and somehow adorable.", abilities:['nibble'], attackFlavor:['scurried toward','threw seeds at','squeaked menacingly at'] },
  rabbit:       { name:'Rabbit',        emoji:'🐰', tier:2,  cost:1500,    rarity:'Common',    baseHp:55,   basePower:6,   baseDefense:3,   hungerDrain:6,  happinessDrain:4,  evolvesTo:'wolf',         evolveLevel:10, desc:"Faster than you think.", abilities:['scratch','thump'], attackFlavor:['hopped at','kicked','bit'] },
  wolf:         { name:'Wolf',          emoji:'🐺', tier:3,  cost:5000,    rarity:'Uncommon',  baseHp:100,  basePower:18,  baseDefense:8,   hungerDrain:8,  happinessDrain:5,  evolvesTo:'bear',         evolveLevel:15, desc:"Loyal to their owner. Territorial with everyone else.", abilities:['howl','bite','pack_call'], attackFlavor:['lunged at','snarled and charged','pinned down'] },
  bear:         { name:'Grizzly Bear',  emoji:'🐻', tier:4,  cost:12000,   rarity:'Uncommon',  baseHp:180,  basePower:35,  baseDefense:20,  hungerDrain:10, happinessDrain:5,  evolvesTo:'kraken',       evolveLevel:20, desc:"Nobody messes with the bear owner.", abilities:['maul','roar','hibernate_heal'], attackFlavor:['mauled','body-slammed','swiped at'] },
  kraken:       { name:'Kraken',        emoji:'🦑', tier:5,  cost:30000,   rarity:'Rare',      baseHp:300,  basePower:60,  baseDefense:35,  hungerDrain:12, happinessDrain:6,  evolvesTo:'basilisk',     evolveLevel:25, desc:"From the deep.", abilities:['ink_spray','tentacle_grab','tidal_wave'], attackFlavor:['wrapped tentacles around','dragged under','crushed'] },
  basilisk:     { name:'Basilisk',      emoji:'🐍', tier:6,  cost:60000,   rarity:'Rare',      baseHp:420,  basePower:90,  baseDefense:50,  hungerDrain:14, happinessDrain:7,  evolvesTo:'phoenix',      evolveLevel:30, desc:"Ancient. Venomous. One look and you're done.", abilities:['petrify','venom_strike','stone_gaze'], attackFlavor:['petrified','bit and venomized','stared down'] },
  phoenix:      { name:'Phoenix',       emoji:'🔥', tier:7,  cost:120000,  rarity:'Epic',      baseHp:600,  basePower:130, baseDefense:70,  hungerDrain:16, happinessDrain:8,  evolvesTo:'leviathan',    evolveLevel:35, desc:"Dies and comes back. Your enemies won't.", abilities:['flame_burst','rebirth','inferno'], attackFlavor:['scorched','incinerated','unleashed hellfire on'] },
  leviathan:    { name:'Leviathan',     emoji:'🌊', tier:8,  cost:250000,  rarity:'Epic',      baseHp:900,  basePower:200, baseDefense:110, hungerDrain:18, happinessDrain:9,  evolvesTo:'dragon',       evolveLevel:40, desc:"Sea serpent the size of a city.", abilities:['tidal_crush','sea_terror','world_flood'], attackFlavor:["tsunami'd",'swallowed','obliterated'] },
  dragon:       { name:'Dragon',        emoji:'🐉', tier:9,  cost:500000,  rarity:'Legendary', baseHp:1400, basePower:320, baseDefense:180, hungerDrain:20, happinessDrain:10, evolvesTo:'world_serpent', evolveLevel:50, desc:"Hoarder of wealth. Destroyer of anyone who threatens its owner.", abilities:['dragon_breath','wing_slam','hoard_passive','terror'], attackFlavor:['breathed fire on','crushed under its claw','annihilated'] },
  world_serpent:{ name:'World Serpent', emoji:'🐲', tier:10, cost:1000000, rarity:'Mythic',    baseHp:2500, basePower:600, baseDefense:350, hungerDrain:25, happinessDrain:12, evolvesTo:null,            evolveLevel:null, desc:"Jörmungandr. Endgame.", abilities:['world_coil','void_bite','apocalypse','passive_terror'], attackFlavor:['coiled around the world and crushed','ended','erased from existence'] },
};

function calcPetStats(pet) {
  const base  = PET_TYPES[pet.type];
  if (!base) return { hp:100, power:10, defense:5 };
  const level = pet.level || 1;
  const upgrades = pet.upgrades || {};
  return {
    hp:      Math.floor(base.baseHp      * (1 + (level-1)*0.15) + (upgrades.health||0)*50),
    power:   Math.floor(base.basePower   * (1 + (level-1)*0.12) + (upgrades.attack||0)*10),
    defense: Math.floor(base.baseDefense * (1 + (level-1)*0.10) + (upgrades.defense||0)*15),
  };
}

function xpForLevel(level) { return Math.floor(100 * Math.pow(level, 1.5)); }

module.exports = { preloadPetCache, getPet, savePet, deletePet, getAllPets, PET_TYPES, calcPetStats, xpForLevel };
