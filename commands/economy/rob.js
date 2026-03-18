const { SlashCommandBuilder } = require('discord.js');
const { getUser, saveUser, isPurgeActive, getConfig } = require('../../utils/db');
const { robSuccessEmbed, robFailEmbed, errorEmbed } = require('../../utils/embeds');

const cooldowns      = new Map();
const SUCCESS_CHANCE = 0.45;
const PURGE_CHANCE   = 0.70;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription("Attempt to rob another user's wallet.")
    .addUserOption((o) => o.setName('target').setDescription('Who to rob').setRequired(true)),

  async execute(interaction) {
    const robberId = interaction.user.id;
    const target   = interaction.options.getUser('target');
    const purge    = isPurgeActive();

    // Read cooldown from config — dashboard can change it live
    const config      = getConfig();
    const COOLDOWN_MS = (config.robCooldownMinutes ?? 5) * 60 * 1000;

    if (target.id === robberId) return interaction.reply({ embeds: [errorEmbed("You can't rob yourself!")], ephemeral: true });
    if (target.bot)             return interaction.reply({ embeds: [errorEmbed("You can't rob a bot!")],   ephemeral: true });

    // ---- PROTECTED ROLE CHECK ----
    // Works even during purge — protected roles are always safe
    const protectedRoles = config.protectedRoles || [];
    if (protectedRoles.length) {
      const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (targetMember && protectedRoles.some(roleId => targetMember.roles.cache.has(roleId))) {
        return interaction.reply({
          embeds: [errorEmbed(`🛡️ **${target.username}** is protected and cannot be robbed.`)],
          ephemeral: true,
        });
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

    const victim = getUser(target.id);
    if (victim.wallet <= 0) return interaction.reply({ embeds: [errorEmbed(`**${target.username}** has nothing in their wallet!`)] });

    cooldowns.set(robberId, Date.now());

    const success = Math.random() < (purge ? PURGE_CHANCE : SUCCESS_CHANCE);

    if (success) {
      const pct    = 0.1 + Math.random() * 0.3;
      const stolen = Math.floor(victim.wallet * pct);
      victim.wallet -= stolen;
      const robber  = getUser(robberId);
      robber.wallet += stolen;
      saveUser(target.id, victim);
      saveUser(robberId, robber);
      await interaction.reply({ embeds: [robSuccessEmbed(stolen, target.username, robber.wallet, purge)] });
    } else {
      const robber = getUser(robberId);
      const fine   = Math.floor(robber.wallet * 0.1);
      robber.wallet = Math.max(0, robber.wallet - fine);
      saveUser(robberId, robber);
      await interaction.reply({ embeds: [robFailEmbed(fine, robber.wallet)] });
    }
  },
};
