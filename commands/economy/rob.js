const { SlashCommandBuilder } = require('discord.js');
const { getHome: _gh, isSleeping: _is } = require('../../utils/homeDb');
const { getOrCreateUser, saveUser, isPurgeActive, getConfig } = require('../../utils/db');
const { robSuccessEmbed, robFailEmbed, errorEmbed } = require('../../utils/embeds');
const { addHeat, checkPoliceRaid, isJailed, getJailTimeLeft } = require('../../utils/police');
const { noAccount } = require('../../utils/accountCheck');

const cooldowns      = new Map();
const SUCCESS_CHANCE = 0.80;
const PURGE_CHANCE   = 0.95;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription("Attempt to rob another user's wallet.")
    .addUserOption((o) => o.setName('target').setDescription('Who to rob').setRequired(true)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const robberId = interaction.user.id;
    const target   = interaction.options.getUser('target');
    const purge    = isPurgeActive(interaction.guildId);

    // Always read fresh config — dashboard may have changed it
    const config      = getConfig(interaction.guildId);
    const COOLDOWN_MS = (config.robCooldownMinutes ?? 5) * 60 * 1000;

    if (target.id === robberId) return interaction.reply({ embeds: [errorEmbed("You can't rob yourself!")], ephemeral: true });
    if (target.bot)             return interaction.reply({ embeds: [errorEmbed("You can't rob a bot!")],   ephemeral: true });

    // ── JAIL CHECK ────────────────────────────────────────────
    if (isJailed(robberId)) {
      const mins = getJailTimeLeft(robberId);
      return interaction.reply({ embeds: [errorEmbed(`🚔 You're in jail! Release in **${mins} minute(s)**.`)], ephemeral: true });
    }

    // ---- PROTECTED ROLE CHECK ----
    const protectedRoles = Array.isArray(config.protectedRoles) ? config.protectedRoles : [];
    if (protectedRoles.length > 0) {
      const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (targetMember) {
        await targetMember.fetch().catch(() => {});
        const isProtected = protectedRoles.some(roleId => targetMember.roles.cache.has(roleId));
        if (isProtected) {
          return interaction.reply({
            embeds: [errorEmbed(`🛡️ **${target.username}** is protected and cannot be robbed.`)],
            ephemeral: true,
          });
        }
      }
    }

    if (!purge) {
      const last = cooldowns.get(robberId);
      if (last) {
        const left = COOLDOWN_MS - (Date.now() - last);
        if (left > 0) {
          const m = Math.ceil(left / 60000);
          return interaction.reply({ embeds: [errorEmbed(`Wait **${m} more minute(s)** before robbing again.`)], ephemeral: true });
        }
      }
    }

    const victim = getOrCreateUser(target.id);
    if (victim.wallet <= 0) return interaction.reply({ embeds: [errorEmbed(`**${target.username}** has nothing in their wallet!`)] });

    cooldowns.set(robberId, Date.now());

    // Apply rob_boost consume buff
    const { getConsumeBuff } = require('../../utils/consumeBuffs');
    const robBoost    = getConsumeBuff(robberId, 'rob_boost');
    const baseChance  = purge ? PURGE_CHANCE : SUCCESS_CHANCE;
    const finalChance = Math.min(0.95, baseChance + robBoost / 100);
    const success     = Math.random() < finalChance;

    if (success) {
      const pct    = 0.1 + Math.random() * 0.3;
      const stolen = Math.floor(victim.wallet * pct);
      victim.wallet -= stolen;
      const robber  = getOrCreateUser(robberId);
      robber.wallet += stolen;
      saveUser(target.id, victim);
      saveUser(robberId, robber);
      await interaction.reply({ embeds: [robSuccessEmbed(stolen, target.username, robber.wallet, purge)] });
      // Heat for successful rob
      await addHeat(robberId, 10, 'robbery');
    } else {
      const robber = getOrCreateUser(robberId);
      const fine   = Math.floor(robber.wallet * 0.1);
      robber.wallet = Math.max(0, robber.wallet - fine);
      saveUser(robberId, robber);
      await interaction.reply({ embeds: [robFailEmbed(fine, robber.wallet)] });
      // More heat for getting caught
      await addHeat(robberId, 20, 'caught robbing');
    }

    // Check if heat is high enough to trigger a police raid → prison
    const raid = await checkPoliceRaid(robberId, interaction.client, config.prisonChannelId || config.purgeChannelId);
    if (raid) {
      const mins = raid.jailTime;
      await interaction.followUp({ embeds: [{
        color: 0x003580,
        title: '🚨 POLICE RAID — You\'re Locked Up!',
        description: `Too much heat! Police raided you.\n\n💸 Seized: **$${raid.stolen.toLocaleString()}**\n⏳ Jailed: **${mins} minutes**\n\nYou've been sent to the prison channel.`,
      }], ephemeral: true });
    }
  },
};
