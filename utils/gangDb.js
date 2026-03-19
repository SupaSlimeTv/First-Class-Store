// ============================================================
// utils/gangDb.js — Gang Database
// ============================================================
const fs   = require('fs');
const path = require('path');

const GANG_FILE   = path.join(__dirname, '../data/gangs.json');
const POLICE_FILE = path.join(__dirname, '../data/police.json');
const WAR_FILE    = path.join(__dirname, '../data/gangWars.json');

function readGangs()  { try { return fs.existsSync(GANG_FILE)   ? JSON.parse(fs.readFileSync(GANG_FILE,   'utf8')) : {}; } catch { return {}; } }
function readPolice() { try { return fs.existsSync(POLICE_FILE) ? JSON.parse(fs.readFileSync(POLICE_FILE, 'utf8')) : {}; } catch { return {}; } }
function readWars()   { try { return fs.existsSync(WAR_FILE)    ? JSON.parse(fs.readFileSync(WAR_FILE,    'utf8')) : {}; } catch { return {}; } }

function saveGangs(d)  { fs.writeFileSync(GANG_FILE,   JSON.stringify(d, null, 2)); }
function savePolice(d) { fs.writeFileSync(POLICE_FILE, JSON.stringify(d, null, 2)); }
function saveWars(d)   { fs.writeFileSync(WAR_FILE,    JSON.stringify(d, null, 2)); }

function getGang(gangId)          { return readGangs()[gangId]   || null; }
function getGangByMember(userId)  { return Object.values(readGangs()).find(g => g.members.some(m => m.userId === userId)) || null; }
function getAllGangs()             { return readGangs(); }
function saveGang(gangId, data)   { const all = readGangs(); all[gangId] = data; saveGangs(all); }
function deleteGang(gangId)       { const all = readGangs(); delete all[gangId]; saveGangs(all); }

function getPoliceRecord(userId)  { return readPolice()[userId]  || { userId, heat: 0, arrests: 0, jailUntil: null, offenses: [] }; }
function savePoliceRecord(userId, data) { const all = readPolice(); all[userId] = data; savePolice(all); }

function getWar(warId)            { return readWars()[warId]     || null; }
function getAllWars()              { return readWars(); }
function saveWar(warId, data)     { const all = readWars(); all[warId] = data; saveWars(all); }
function deleteWar(warId)         { const all = readWars(); delete all[warId]; saveWars(all); }

// GANG_RANKS — progression system
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
