const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllBusinesses, BIZ_TYPES, calcIncome } = require('../../utils/bizDb');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('businesses')
    .setDescription('See all businesses in the server ranked by level.'),

  async execute(interaction) {
    const all  = getAllBusinesses();
    const list = Object.values(all).sort((a,b) => (b.level - a.level) || (b.totalEarned - a.totalEarned));

    if (!list.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('🏢 No Businesses Yet').setDescription('No one has started a business yet!\nUse `/business start` to be the first entrepreneur.')], ephemeral: true });

    const lines = list.slice(0, 15).map((biz, i) => {
      const type = BIZ_TYPES[biz.type];
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i+1}.**`;
      return `${medal} ${type?.emoji || '🏢'} **${biz.name}** — Lvl ${biz.level} · $${calcIncome(biz).toLocaleString()}/min · <@${biz.ownerId}>`;
    });

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0xf5c518)
      .setTitle('🏢 Business Rankings')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${list.length} total businesses · Use /business view for your stats` })
    ]});
  },
};
