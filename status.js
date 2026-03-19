const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { listConsumeBuffs } = require('../../utils/consumeBuffs');
const { noAccount } = require('../../utils/accountCheck');

const BUFF_EMOJIS = {
  rob_boost:     '🔫', work_boost:  '💼', crime_boost: '🌡️',
  passive_boost: '💰', shield:      '🛡️', speed:       '⚡',
  lucky:         '🍀', poisoned:    '☠️', high:        '😵',
  focused:       '🎯',
};

const BUFF_NAMES = {
  rob_boost:     'Rob Boost',     work_boost:    'Work Boost',
  crime_boost:   'Crime Boost',   passive_boost: 'Passive Boost',
  shield:        'Shield',        speed:         'Speed Boost',
  lucky:         'Lucky',         poisoned:      'Poisoned ⚠️',
  high:          'High',          focused:       'Focused',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check your currently active buffs and effects.'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const buffs = listConsumeBuffs(interaction.user.id);

    if (!buffs.length) {
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x888888)
        .setTitle('📊 Your Status')
        .setDescription('No active buffs or debuffs.\n\nConsume items from your inventory to gain effects!')
      ], ephemeral: true });
    }

    const lines = buffs.map(b => {
      const emoji = BUFF_EMOJIS[b.buffType] || '✨';
      const name  = BUFF_NAMES[b.buffType]  || b.buffType;
      const bar   = '█'.repeat(Math.ceil(b.minutesLeft / 2)).slice(0, 10) + '░'.repeat(Math.max(0, 10 - Math.ceil(b.minutesLeft / 2)));
      return `${emoji} **${name}** (+${b.strength}%)\n  \`[${bar}]\` ${b.minutesLeft}m remaining`;
    });

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📊 Your Active Effects')
      .setDescription(lines.join('\n\n'))
      .setFooter({ text: `${buffs.length}/3 buff slots used · Effects expire automatically` })
    ], ephemeral: true });
  },
};
