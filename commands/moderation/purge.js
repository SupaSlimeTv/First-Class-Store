// ============================================================
// commands/moderation/purge.js
// Slash command: /purge <start|end>
// Requires canPurge permission
// On start: drains ALL users' banks into wallets, removes rob cooldown
// On end:   restores normal operations
//
// TEACHES: Bulk data operations, announcement channels, role gating
// ============================================================

const { SlashCommandBuilder } = require('discord.js');
const { getConfig, saveConfig, getAllUsers, saveAllUsers } = require('../../utils/db');
const { canStartPurge } = require('../../utils/permissions');
const { purgeEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Start or end the purge event.')
    .addStringOption((o) =>
      o
        .setName('action')
        .setDescription('Start or end the purge')
        .setRequired(true)
        .addChoices(
          { name: '🔴 Start the Purge', value: 'start' },
          { name: '🟢 End the Purge',   value: 'end' }
        )
    ),

  async execute(interaction) {
    // Permission check — only roles with canPurge (or admins) can use this
    if (!canStartPurge(interaction.member)) {
      return interaction.reply({
        embeds: [errorEmbed('You don\'t have permission to control the purge.')],
        ephemeral: true,
      });
    }

    const action = interaction.options.getString('action');
    const config = getConfig();

    if (action === 'start') {
      if (config.purgeActive) {
        return interaction.reply({
          embeds: [errorEmbed('The purge is already active!')],
          ephemeral: true,
        });
      }

      // ---- DRAIN ALL BANKS INTO WALLETS ----
      // This is the key mechanic — every user's bank is zeroed, moved to wallet
      const allUsers = getAllUsers();

      for (const userId in allUsers) {
        // "for...in" loops over object keys (user IDs in this case)
        const user = allUsers[userId];
        user.wallet += user.bank; // move bank funds to wallet
        user.bank = 0;            // zero out the bank
      }

      saveAllUsers(allUsers);

      // Activate purge in config
      config.purgeActive = true;
      config.purgeStartTime = Date.now();
      saveConfig(config);

      // Announce in the channel where command was run
      await interaction.reply({ embeds: [purgeEmbed(true)] });

    } else if (action === 'end') {
      if (!config.purgeActive) {
        return interaction.reply({
          embeds: [errorEmbed('The purge is not currently active.')],
          ephemeral: true,
        });
      }

      config.purgeActive = false;
      config.purgeStartTime = null;
      saveConfig(config);

      await interaction.reply({ embeds: [purgeEmbed(false)] });
    }
  },
};
