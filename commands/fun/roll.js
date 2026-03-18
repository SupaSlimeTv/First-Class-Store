// commands/fun/roll.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll a dice.')
    .addIntegerOption((o) =>
      o.setName('sides').setDescription('Number of sides (default 6)').setMinValue(2).setMaxValue(1000).setRequired(false)
    ),

  async execute(interaction) {
    const sides = interaction.options.getInteger('sides') ?? 6;
    const result = Math.floor(Math.random() * sides) + 1;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.INFO)
          .setTitle('🎲 Dice Roll')
          .setDescription(`You rolled a **${result}** on a d${sides}!`),
      ],
    });
  },
};
