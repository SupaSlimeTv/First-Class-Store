const { SlashCommandBuilder } = require('discord.js');
const { deposit, isPurgeActive, getOrCreateUser } = require('../../utils/db');
const { depositEmbed, errorEmbed } = require('../../utils/embeds');
const { noAccount } = require('../../utils/accountCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Deposit money from your wallet into your bank.')
    .addStringOption((o) => o.setName('amount').setDescription('Amount or "all"').setRequired(true)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    if (isPurgeActive()) return interaction.reply({ embeds: [errorEmbed('🔴 **THE PURGE IS ACTIVE!**\nDeposits are disabled.')], ephemeral: true });
    const user  = getOrCreateUser(interaction.user.id);
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
