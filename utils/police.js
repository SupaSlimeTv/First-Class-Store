// ============================================================
// utils/police.js — Police & Heat System
// Heat builds from criminal activity. High heat = police raids.
// ============================================================

const { getPoliceRecord, savePoliceRecord, getGangByMember, saveGang } = require('./gangDb');
const db = require('./db');

// Heat thresholds
const HEAT_LEVELS = [
  { level: 0, name: '🟢 Clean',     maxHeat: 25  },
  { level: 1, name: '🟡 Wanted',    maxHeat: 50  },
  { level: 2, name: '🟠 Hot',       maxHeat: 75  },
  { level: 3, name: '🔴 Fugitive',  maxHeat: 90  },
  { level: 4, name: '💀 Most Wanted', maxHeat: 100 },
];

function getHeatLevel(heat) {
  return [...HEAT_LEVELS].reverse().find(h => heat >= h.maxHeat - 25) || HEAT_LEVELS[0];
}

// Add heat to a user from a crime
function addHeat(userId, amount, offense) {
  const record     = getPoliceRecord(userId);
  record.heat      = Math.min(100, (record.heat || 0) + amount);
  record.offenses  = record.offenses || [];
  record.offenses.push({ type: offense, time: Date.now(), heat: amount });
  if (record.offenses.length > 20) record.offenses = record.offenses.slice(-20);
  savePoliceRecord(userId, record);
  return record;
}

// Decay heat over time (called on tick)
function decayHeat() {
  const fs   = require('fs');
  const path = require('path');
  const POLICE_FILE = path.join(__dirname, '../data/police.json');
  try {
    if (!fs.existsSync(POLICE_FILE)) return;
    const all = JSON.parse(fs.readFileSync(POLICE_FILE, 'utf8'));
    let changed = false;
    for (const userId in all) {
      const record = all[userId];
      if (record.jailUntil && Date.now() > record.jailUntil) {
        record.jailUntil = null; // release from jail
        changed = true;
      }
      if (record.heat > 0) {
        record.heat = Math.max(0, record.heat - 1); // -1 heat per tick
        changed = true;
      }
    }
    if (changed) fs.writeFileSync(POLICE_FILE, JSON.stringify(all, null, 2));
  } catch {}
}

// Check if police raid triggers based on heat
async function checkPoliceRaid(userId, client, channelId) {
  const record   = getPoliceRecord(userId);
  const heat     = record.heat || 0;

  // Raid probability scales with heat
  const raidChance = heat > 80 ? 0.35 : heat > 60 ? 0.15 : heat > 40 ? 0.05 : 0;
  if (Math.random() > raidChance) return null;

  // RAID triggered
  const user       = db.getOrCreateUser(userId);
  const stolen     = Math.floor(user.wallet * (0.1 + Math.random() * 0.3));
  user.wallet      = Math.max(0, user.wallet - stolen);
  record.heat      = Math.max(0, heat - 20);
  record.arrests   = (record.arrests || 0) + 1;
  const jailMins   = 5 + Math.floor(Math.random() * 10); // 5-15 min
  const jailTime   = jailMins * 60 * 1000;
  record.jailUntil = Date.now() + jailTime;

  db.saveUser(userId, user);
  await savePoliceRecord(userId, record);

  // ── SEND TO PRISON CHANNEL + APPLY PRISON ROLE ────────────
  if (client) {
    try {
      const { EmbedBuilder } = require('discord.js');
      for (const [guildId, guild] of client.guilds.cache) {
        const config = db.getConfig(guildId);

        // Apply prison role to member
        if (config.prisonRoleId) {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member) {
            await member.roles.add(config.prisonRoleId).catch(() => null);
            // Auto-release after jail time
            setTimeout(async () => {
              await member.roles.remove(config.prisonRoleId).catch(() => null);
            }, jailTime);
          }
        }

        // Announce in prison channel
        const prisonChanId = config.prisonChannelId || channelId;
        if (prisonChanId) {
          const channel = await client.channels.fetch(prisonChanId).catch(() => null);
          if (channel) {
            await channel.send({ embeds: [new EmbedBuilder()
              .setColor(0x003580)
              .setTitle('🚔 POLICE RAID — ARRESTED!')
              .setDescription(
                `<@${userId}> had too much heat and got raided!\n\n` +
                `💸 Seized: **$${stolen.toLocaleString()}**\n` +
                `⏳ Jailed: **${jailMins} minutes**\n` +
                `🌡️ Heat reduced to: **${record.heat}**\n\n` +
                `*Lay low next time.*`
              )
              .setTimestamp()
            ]}).catch(() => null);
          }
        }
      }
    } catch(e) { console.error('checkPoliceRaid announce error:', e.message); }
  }

  return { stolen, jailTime: jailMins };
}

function isJailed(userId) {
  const record = getPoliceRecord(userId);
  return record.jailUntil && Date.now() < record.jailUntil;
}

function getJailTimeLeft(userId) {
  const record = getPoliceRecord(userId);
  if (!record.jailUntil || Date.now() >= record.jailUntil) return 0;
  return Math.ceil((record.jailUntil - Date.now()) / 60000);
}

module.exports = { addHeat, decayHeat, checkPoliceRaid, isJailed, getJailTimeLeft, getHeatLevel, HEAT_LEVELS };
