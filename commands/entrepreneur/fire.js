const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBusiness, saveBusiness } = require('../../utils/bizDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fire')
    .setDescription('Fire an employee from your business.')
    .addUserOption(o => o.setName('user').setDescription('Who to fire').setRequired(true)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const target = interaction.options.getUser('user');
    const userId = interaction.user.id;

    const biz = getBusiness(userId);
    if (!biz) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a business.")], ephemeral: true });

    const idx = biz.employees.findIndex(e => e.userId === target.id);
    if (idx === -1) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`**${target.username}** doesn't work for you.`)], ephemeral: true });

    const emp = biz.employees[idx];
    biz.employees.splice(idx, 1);
    saveBusiness(userId, biz);

    try {
      await target.send({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('📋 You\'ve Been Let Go').setDescription(`**${interaction.user.username}** has removed you from **${biz.name}**.\n\nBetter luck at your next job.`)] });
    } catch {}

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0x888888)
      .setTitle(`📋 ${target.username} Fired`)
      .setDescription(`**${target.username}** (${emp.role}) has been let go from **${biz.name}**.`)
      .addFields({ name: '👥 Staff', value: `${biz.employees.length} / 5`, inline: true })
    ]});
  },
};
