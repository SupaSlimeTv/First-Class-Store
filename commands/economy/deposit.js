const { SlashCommandBuilder } = require('discord.js');
const { deposit, isPurgeActive, getUser } = require('../../utils/db');
const { depositEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Deposit money from your wallet into your bank.')
    .addStringOption((o) => o.setName('amount').setDescription('Amount or "all"').setRequired(true)),

  async execute(interaction) {
    if (isPurgeActive()) {
      return interaction.reply({ embeds: [errorEmbed('🔴 **THE PURGE IS ACTIVE!**\nDeposits are disabled.')], ephemeral: true });
    }
    const user  = getUser(interaction.user.id);
    const input = interaction.options.getString('amount').toLowerCase();
    const amount = input === 'all' ? user.wallet : parseInt(input);

    if (isNaN(amount) || amount <= 0) return interaction.reply({ embeds: [errorEmbed('Enter a valid amount greater than 0.')], ephemeral: true });
    if (amount > user.wallet) return interaction.reply({ embeds: [errorEmbed(`You only have **$${user.wallet.toLocaleString()}** in your wallet.`)], ephemeral: true });

    try {
      const updated = deposit(interaction.user.id, amount);
      await interaction.reply({ embeds: [depositEmbed(updated, amount)] });
    } catch (err) {
      await interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
    }
  },
};
