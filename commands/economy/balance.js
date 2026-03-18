// ============================================================
// commands/economy/balance.js
// Slash command: /balance [user]
// Shows wallet + bank balance. Optionally check another user.
// ============================================================

const { SlashCommandBuilder } = require('discord.js');
const { getUser } = require('../../utils/db');
const { balanceEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  // SlashCommandBuilder defines what the slash command looks like in Discord
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your wallet and bank balance.')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Check another user\'s balance (optional)')
        .setRequired(false) // optional — if not provided, shows your own
    ),

  async execute(interaction) {
    // Get the optional user argument — defaults to the person who ran the command
    // interaction.options.getUser() returns a Discord User object or null
    const target = interaction.options.getUser('user') || interaction.user;

    const userData = getUser(target.id);

    await interaction.reply({
      embeds: [balanceEmbed(userData, target)],
    });
  },
};
