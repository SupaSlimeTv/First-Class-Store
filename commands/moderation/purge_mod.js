const { SlashCommandBuilder } = require('discord.js');
const { getConfig, saveConfig, getAllUsers, saveAllUsers } = require('../../utils/db');
const { canStartPurge } = require('../../utils/permissions');
const { purgeEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Start or end the purge event.')
    .addStringOption((o) =>
      o.setName('action').setDescription('Start or end the purge').setRequired(true)
        .addChoices(
          { name: '🔴 Start the Purge', value: 'start' },
          { name: '🟢 End the Purge',   value: 'end' }
        )
    ),

  async execute(interaction) {
    if (!canStartPurge(interaction.member)) {
      return interaction.reply({
        embeds: [errorEmbed('You don\'t have permission to control the purge.')],
        ephemeral: true,
      });
    }

    const action = interaction.options.getString('action');
    const config = getConfig(interaction.guildId);

    if (action === 'start') {
      if (config.purgeActive) {
        return interaction.reply({ embeds: [errorEmbed('The purge is already active!')], ephemeral: true });
      }

      // Drain all banks into wallets
      const allUsers = getAllUsers();
      for (const userId in allUsers) {
        const user = allUsers[userId];
        user.wallet += user.bank;
        user.bank = 0;
      }
      saveAllUsers(allUsers);

      config.purgeActive    = true;
      config.purgeStartTime = Date.now();
      saveConfig(config);

      // Reply with the purge embed
      await interaction.reply({ embeds: [purgeEmbed(true)] });

      // @everyone announcement in the same channel
      await interaction.channel.send({
        content: '@everyone',
        embeds: [
          purgeEmbed(true)
            .setTitle('🔴 @everyone — THE PURGE HAS BEGUN')
        ],
        allowedMentions: { parse: ['everyone'] },
      });

    } else if (action === 'end') {
      if (!config.purgeActive) {
        return interaction.reply({ embeds: [errorEmbed('The purge is not currently active.')], ephemeral: true });
      }

      config.purgeActive    = false;
      config.purgeStartTime = null;
      saveConfig(config);

      await interaction.reply({ embeds: [purgeEmbed(false)] });

      // @everyone end announcement
      await interaction.channel.send({
        content: '@everyone',
        embeds: [purgeEmbed(false)],
        allowedMentions: { parse: ['everyone'] },
      });
    }
  },
};
