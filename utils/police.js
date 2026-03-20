// ============================================================
// utils/police.js — Multi-Server Edition
// Heat and jail are per-server
// ============================================================

const { getPoliceRecord, savePoliceRecord } = require('./gangDb');
const db = require('./db');

const HEAT_LEVELS = [
  { level:0, name:'🟢 Clean',        maxHeat:25  },
  { level:1, name:'🟡 Wanted',       maxHeat:50  },
  { level:2, name:'🟠 Hot',          maxHeat:75  },
  { level:3, name:'🔴 Fugitive',     maxHeat:90  },
  { level:4, name:'💀 Most Wanted',  maxHeat:100 },
];

function getHeatLevel(heat) {
  return [...HEAT_LEVELS].reverse().find(h => heat >= h.maxHeat - 25) || HEAT_LEVELS[0];
}

async function addHeat(userId, amount, offense, guildId) {
  const record    = await getPoliceRecord(userId, guildId);
  record.heat     = Math.min(100, (record.heat || 0) + amount);
  record.offenses = record.offenses || [];
  record.offenses.push({ type: offense, time: Date.now(), heat: amount });
  if (record.offenses.length > 20) record.offenses = record.offenses.slice(-20);
  await savePoliceRecord(userId, record, guildId);
  return record;
}

async function decayHeat(guildId) {
  const { guildCol } = require('./mongo');
  const c   = await guildCol('police', guildId);
  const all = await c.find({ $or: [{ heat: { $gt: 0 } }, { jailUntil: { $ne: null } }] }).toArray();
  for (const record of all) {
    const update = {};
    if (record.jailUntil && Date.now() > record.jailUntil) update.jailUntil = null;
    if (record.heat > 0) update.heat = Math.max(0, record.heat - 1);
    if (Object.keys(update).length) await c.updateOne({ _id: record._id }, { $set: update });
  }
}

async function checkPoliceRaid(userId, guildId, client, channelId) {
  const record     = await getPoliceRecord(userId, guildId);
  const heat       = record.heat || 0;
  const raidChance = heat > 80 ? 0.35 : heat > 60 ? 0.15 : heat > 40 ? 0.05 : 0;
  if (Math.random() > raidChance) return null;

  const user       = await db.getOrCreateUser(userId);
  const stolen     = Math.floor(user.wallet * (0.1 + Math.random() * 0.3));
  user.wallet      = Math.max(0, user.wallet - stolen);
  record.heat      = Math.max(0, heat - 20);
  record.arrests   = (record.arrests || 0) + 1;
  const jailMs     = (5 + Math.floor(Math.random() * 10)) * 60000;
  record.jailUntil = Date.now() + jailMs;

  await db.saveUser(userId, user);
  await savePoliceRecord(userId, record, guildId);

  if (client && channelId) {
    try {
      const { EmbedBuilder } = require('discord.js');
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.send({ embeds: [new EmbedBuilder()
        .setColor(0x003580)
        .setTitle('🚔 POLICE RAID!')
        .setDescription(`<@${userId}> got raided! Officers seized **$${stolen.toLocaleString()}** and they're in jail for **${Math.round(jailMs/60000)} minutes**.`)
        .setTimestamp()
      ]});
    } catch {}
  }
  return { stolen, jailTime: Math.round(jailMs / 60000) };
}

async function isJailed(userId, guildId) {
  const record = await getPoliceRecord(userId, guildId);
  return !!(record.jailUntil && Date.now() < record.jailUntil);
}

async function getJailTimeLeft(userId, guildId) {
  const record = await getPoliceRecord(userId, guildId);
  if (!record.jailUntil || Date.now() >= record.jailUntil) return 0;
  return Math.ceil((record.jailUntil - Date.now()) / 60000);
}

module.exports = { addHeat, decayHeat, checkPoliceRaid, isJailed, getJailTimeLeft, getHeatLevel, HEAT_LEVELS };
