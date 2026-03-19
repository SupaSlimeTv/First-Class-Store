const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllBusinesses, BIZ_TYPES, calcIncome } = require('../../utils/bizDb');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myjobs')
    .setDescription('See all businesses you work for as an employee.'),

  async execute(interaction) {
    const all  = getAllBusinesses();
    const jobs = Object.values(all).filter(b => b.employees.some(e => e.userId === interaction.user.id));

    if (!jobs.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.INFO).setDescription("You're not employed anywhere. Wait for a business owner to `/hire` you!")], ephemeral: true });

    const lines = jobs.map(biz => {
      const type = BIZ_TYPES[biz.type];
      const emp  = biz.employees.find(e => e.userId === interaction.user.id);
      const cut  = Math.floor(calcIncome(biz) * 0.1);
      return `${type?.emoji || '🏢'} **${biz.name}** — ${emp.role}\n  Owner: <@${biz.ownerId}> · Your cut: ~$${cut.toLocaleString()}/collection`;
    });

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('💼 Your Jobs')
      .setDescription(lines.join('\n\n'))
      .setFooter({ text: 'You earn 10% of each collection automatically when the owner collects.' })
    ]});
  },
};
