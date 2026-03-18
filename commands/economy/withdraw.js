const { SlashCommandBuilder } = require('discord.js');
const { withdraw, isPurgeActive, getOrCreateUser } = require('../../utils/db');
const { withdrawEmbed, errorEmbed } = require('../../utils/embeds');
const { noAccount } = require('../../utils/accountCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Withdraw money from your bank into your wallet.')
    .addStringOption((o) => o.setName('amount').setDescription('Amount or "all"').setRequired(true)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    if (isPurgeActive()) return interaction.reply({ embeds: [errorEmbed('🔴 **THE PURGE IS ACTIVE!**\nWithdrawals are disabled.')], ephemeral: true });
    const user  = getOrCreateUser(interaction.user.id);
    const input = interaction.options.getString('amount').toLowerCase();
    const amount = input === 'all' ? user.bank : parseInt(input);
    if (isNaN(amount) || amount <= 0) return interaction.reply({ embeds: [errorEmbed('Enter a valid amount greater than 0.')], ephemeral: true });
    if (amount > user.bank) return interaction.reply({ embeds: [errorEmbed(`You only have **$${user.bank.toLocaleString()}** in your bank.`)], ephemeral: true });
    try {
      const updated = withdraw(interaction.user.id, amount);
      await interaction.reply({ embeds: [withdrawEmbed(updated, amount)] });
    } catch (err) {
      await interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
    }
  },
};
