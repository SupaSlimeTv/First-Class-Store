const { SlashCommandBuilder } = require('discord.js');
const { getUser } = require('../../utils/db');
const { balanceEmbed, errorEmbed } = require('../../utils/embeds');
const { noAccount } = require('../../utils/accountCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your wallet and bank balance.')
    .addUserOption((o) => o.setName('user').setDescription("Check another user's balance").setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const userData = getUser(target.id);
    if (!userData) {
      const isSelf = target.id === interaction.user.id;
      return interaction.reply({
        embeds: [errorEmbed(isSelf
          ? `You don't have an account yet! Type \`!open account\` to get started.`
          : `**${target.username}** doesn't have an account yet.`)],
        ephemeral: true,
      });
    }
    await interaction.reply({ embeds: [balanceEmbed(userData, target)] });
  },
};
