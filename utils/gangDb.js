// ============================================================
// utils/gangDb.js — Multi-Server Edition
// Gangs, police, wars = PER-SERVER (guildId required)
// ============================================================

const { guildCol } = require('./mongo');

// ── GANGS (PER-SERVER) ────────────────────────────────────────

async function getGang(gangId, guildId) {
  const c = await guildCol('gangs', guildId);
  return await c.findOne({ _id: gangId }) || null;
}

async function getGangByMember(userId, guildId) {
  const c = await guildCol('gangs', guildId);
  return await c.findOne({ 'members.userId': userId }) || null;
}

async function getAllGangs(guildId) {
  const c    = await guildCol('gangs', guildId);
  const docs = await c.find({}).toArray();
  return Object.fromEntries(docs.map(d => [d._id, d]));
}

async function saveGang(gangId, data, guildId) {
  const c = await guildCol('gangs', guildId);
  const { _id, ...rest } = data;
  await c.updateOne({ _id: gangId }, { $set: rest }, { upsert: true });
}

async function deleteGang(gangId, guildId) {
  const c = await guildCol('gangs', guildId);
  await c.deleteOne({ _id: gangId });
}

// ── POLICE (PER-SERVER) ───────────────────────────────────────

async function getPoliceRecord(userId, guildId) {
  const c   = await guildCol('police', guildId);
  const doc = await c.findOne({ _id: userId });
  return doc || { userId, heat: 0, arrests: 0, jailUntil: null, offenses: [] };
}

async function savePoliceRecord(userId, data, guildId) {
  const c = await guildCol('police', guildId);
  const { _id, ...rest } = data;
  await c.updateOne({ _id: userId }, { $set: rest }, { upsert: true });
}

// ── GANG WARS (PER-SERVER) ────────────────────────────────────

async function getWar(warId, guildId) {
  const c = await guildCol('gangWars', guildId);
  return await c.findOne({ _id: warId }) || null;
}

async function getAllWars(guildId) {
  const c    = await guildCol('gangWars', guildId);
  const docs = await c.find({}).toArray();
  return Object.fromEntries(docs.map(d => [d._id, d]));
}

async function saveWar(warId, data, guildId) {
  const c = await guildCol('gangWars', guildId);
  const { _id, ...rest } = data;
  await c.updateOne({ _id: warId }, { $set: rest }, { upsert: true });
}

async function deleteWar(warId, guildId) {
  const c = await guildCol('gangWars', guildId);
  await c.deleteOne({ _id: warId });
}

// ── RANKS ─────────────────────────────────────────────────────

const GANG_RANKS = [
  { name: 'Prospect',    minRep: 0    },
  { name: 'Soldier',     minRep: 100  },
  { name: 'Associate',   minRep: 300  },
  { name: 'Capo',        minRep: 700  },
  { name: 'Underboss',   minRep: 1500 },
  { name: 'Consigliere', minRep: 3000 },
];

function getMemberRank(rep) {
  return [...GANG_RANKS].reverse().find(r => rep >= r.minRep) || GANG_RANKS[0];
}

module.exports = {
  getGang, getGangByMember, getAllGangs, saveGang, deleteGang,
  getPoliceRecord, savePoliceRecord,
  getWar, getAllWars, saveWar, deleteWar,
  GANG_RANKS, getMemberRank,
};
