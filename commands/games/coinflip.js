const { SlashCommandBuilder } = require('discord.js');
const { getUser, saveUser } = require('../../utils/db');
const { coinflipEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin and bet on the outcome.')
    .addIntegerOption((o) => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('choice').setDescription('Heads or tails?').setRequired(true)
      .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })),

  async execute(interaction) {
    const bet    = interaction.options.getInteger('bet');
    const choice = interaction.options.getString('choice');
    const user   = getUser(interaction.user.id);

    if (bet > user.wallet) return interaction.reply({ embeds: [errorEmbed(`You only have **$${user.wallet.toLocaleString()}** in your wallet!`)], ephemeral: true });

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won    = result === choice;
    won ? user.wallet += bet : user.wallet -= bet;
    saveUser(interaction.user.id, user);

    await interaction.reply({ embeds: [coinflipEmbed(choice, result, bet, won, user.wallet)] });
  },
};
