// ============================================================
// commands/fun/eightball.js
// Slash command: /8ball <question>
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/embeds');

const RESPONSES = [
  'It is certain. ✅', 'Without a doubt. ✅', 'You may rely on it. ✅',
  'Yes, definitely. ✅', 'Most likely. ✅', 'Signs point to yes. ✅',
  'Ask again later. 🔄', 'Cannot predict now. 🔄', 'Concentrate and ask again. 🔄',
  "Don't count on it. ❌", 'My sources say no. ❌', 'Very doubtful. ❌', 'Outlook not so good. ❌',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a yes/no question.')
    .addStringOption((o) =>
      o.setName('question').setDescription('Your question').setRequired(true)
    ),

  async execute(interaction) {
    const question = interaction.options.getString('question');
    const answer = RESPONSES[Math.floor(Math.random() * RESPONSES.length)];

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.INFO)
          .setTitle('🎱 Magic 8-Ball')
          .addFields(
            { name: 'Question', value: question },
            { name: 'Answer',   value: `**${answer}**` }
          ),
      ],
    });
  },
};
