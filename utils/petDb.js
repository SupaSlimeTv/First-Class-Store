// ============================================================
// utils/petDb.js — MongoDB Edition
// Collection: pets
// ============================================================

const { col } = require('./mongo');

async function getPet(userId) {
  const c = await col('pets');
  return await c.findOne({ _id: userId }) || null;
}

async function savePet(userId, data) {
  const c = await col('pets');
  const { _id, ...rest } = data;
  await c.updateOne({ _id: userId }, { $set: rest }, { upsert: true });
}

async function deletePet(userId) {
  const c = await col('pets');
  await c.deleteOne({ _id: userId });
}

async function getAllPets() {
  const c    = await col('pets');
  const docs = await c.find({}).toArray();
  return Object.fromEntries(docs.map(d => [d._id, d]));
}

const PET_TYPES = {
  dog:        { name:'Dog',        emoji:'🐕',  desc:'Man\'s best friend. Loyal and protective.',                     cost:500,   rarity:'Common',    tier:1,  basePower:5,   baseDefense:3,  baseHp:50,  abilities:['bark','fetch'],                          evolvesTo:'wolf',       evolveLevel:10 },
  cat:        { name:'Cat',        emoji:'🐈',  desc:'Mysterious and independent. Brings luck.',                      cost:500,   rarity:'Common',    tier:1,  basePower:4,   baseDefense:4,  baseHp:45,  abilities:['scratch','stealth'],                     evolvesTo:'panther',    evolveLevel:10 },
  rabbit:     { name:'Rabbit',     emoji:'🐇',  desc:'Fast and lucky. Boosts daily earnings.',                        cost:750,   rarity:'Common',    tier:1,  basePower:3,   baseDefense:2,  baseHp:35,  abilities:['luck_boost','dash'],                     evolvesTo:null,         evolveLevel:null },
  wolf:       { name:'Wolf',       emoji:'🐺',  desc:'Fierce and relentless. Commands fear.',                         cost:3000,  rarity:'Uncommon',  tier:3,  basePower:18,  baseDefense:10, baseHp:120, abilities:['howl','pack_strike','intimidate'],        evolvesTo:'direwolf',   evolveLevel:20 },
  panther:    { name:'Panther',    emoji:'🐆',  desc:'Silent predator. Specializes in ambushes.',                     cost:3000,  rarity:'Uncommon',  tier:3,  basePower:20,  baseDefense:8,  baseHp:100, abilities:['ambush','shadow_strike','stealth'],      evolvesTo:null,         evolveLevel:null },
  bear:       { name:'Bear',       emoji:'🐻',  desc:'Massive and unstoppable. Built for defense.',                   cost:4000,  rarity:'Rare',      tier:5,  basePower:25,  baseDefense:20, baseHp:200, abilities:['slam','roar','fortify'],                 evolvesTo:'polar_bear', evolveLevel:25 },
  eagle:      { name:'Eagle',      emoji:'🦅',  desc:'Eyes like a hawk, strikes like lightning.',                     cost:5000,  rarity:'Rare',      tier:5,  basePower:30,  baseDefense:12, baseHp:110, abilities:['dive_bomb','talon_strike','scout'],      evolvesTo:null,         evolveLevel:null },
  dragon:     { name:'Dragon',     emoji:'🐉',  desc:'Ancient and devastating. The pinnacle of power.',               cost:25000, rarity:'Legendary', tier:9,  basePower:80,  baseDefense:60, baseHp:500, abilities:['fire_breath','dragon_claw','fortify'],   evolvesTo:null,         evolveLevel:null },
  phoenix:    { name:'Phoenix',    emoji:'🔥',  desc:'Born from flame. Mythical protector that defies defeat.',       cost:50000, rarity:'Mythic',    tier:10, basePower:100, baseDefense:80, baseHp:750, abilities:['inferno','rebirth','healing_flame'],     evolvesTo:null,         evolveLevel:null },
  direwolf:   { name:'Direwolf',   emoji:'🐺',  desc:'The apex predator. Evolved and battle-forged.',                 cost:15000, rarity:'Epic',      tier:7,  basePower:55,  baseDefense:35, baseHp:320, abilities:['frenzy','pack_strike','howl'],           evolvesTo:null,         evolveLevel:null },
  polar_bear: { name:'Polar Bear', emoji:'🐻‍❄️', desc:'The ultimate tank. Near-unbreakable defense.',               cost:20000, rarity:'Epic',      tier:7,  basePower:50,  baseDefense:55, baseHp:450, abilities:['blizzard_slam','fortify','frost_aura'],  evolvesTo:null,         evolveLevel:null },
};

function calcPetStats({ type, level, bond }) {
  const pet = PET_TYPES[type];
  if (!pet) return { power:0, defense:0, hp:0 };
  const lvlMult  = 1 + (level - 1) * 0.12;
  const bondMult = 1 + (bond  / 100) * 0.25;
  return {
    power:   Math.floor(pet.basePower   * lvlMult * bondMult),
    defense: Math.floor(pet.baseDefense * lvlMult * bondMult),
    hp:      Math.floor(pet.baseHp      * lvlMult * bondMult),
  };
}

module.exports = { getPet, savePet, deletePet, getAllPets, PET_TYPES, calcPetStats };
