// commands/fun/rps.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/embeds');

const CHOICES = ['rock', 'paper', 'scissors'];
const EMOJIS  = { rock: '🪨', paper: '📄', scissors: '✂️' };
const BEATS   = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Play Rock Paper Scissors!')
    .addStringOption((o) =>
      o.setName('choice').setDescription('Your choice').setRequired(true)
        .addChoices(
          { name: '🪨 Rock',     value: 'rock' },
          { name: '📄 Paper',    value: 'paper' },
          { name: '✂️ Scissors', value: 'scissors' }
        )
    ),

  async execute(interaction) {
    const player = interaction.options.getString('choice');
    const bot    = CHOICES[Math.floor(Math.random() * 3)];

    let result;
    if (player === bot)           result = "It's a **tie**! 🤝";
    else if (BEATS[player] === bot) result = 'You **win**! 🎉';
    else                           result = 'You **lose**! 😈';

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.GAME)
          .setTitle('✊ Rock Paper Scissors')
          .setDescription(
            `${EMOJIS[player]} vs ${EMOJIS[bot]}\n\n${result}`
          ),
      ],
    });
  },
};
