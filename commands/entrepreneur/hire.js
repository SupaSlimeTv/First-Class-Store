const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser } = require('../../utils/db');
const { getBusiness, saveBusiness } = require('../../utils/bizDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const ROLES = ['Manager','Assistant','Accountant','Marketing','Security','Chef','Driver','Technician','Cashier','Supervisor'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hire')
    .setDescription('Hire an employee for your business.')
    .addUserOption(o => o.setName('user').setDescription('Who to hire').setRequired(true))
    .addStringOption(o => o.setName('role').setDescription('Their job title').setRequired(false)
      .addChoices(...ROLES.map(r => ({ name: r, value: r })))
    ),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const target = interaction.options.getUser('user');
    const role   = interaction.options.getString('role') || 'Employee';
    const userId = interaction.user.id;

    if (target.id === userId) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't hire yourself.")], ephemeral: true });
    if (target.bot) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't hire a bot.")], ephemeral: true });

    const biz = getBusiness(userId);
    if (!biz) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a business! Start one with `/business start`.")], ephemeral: true });

    if (biz.employees.length >= 5) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You already have 5 employees — the maximum. Upgrade your business to increase capacity in future updates.")], ephemeral: true });

    if (biz.employees.some(e => e.userId === target.id)) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`**${target.username}** already works for you.`)], ephemeral: true });

    const targetData = getUser(target.id);
    if (!targetData) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`**${target.username}** doesn't have an account yet.`)], ephemeral: true });

    biz.employees.push({ userId: target.id, role, joinedAt: Date.now() });
    await saveBusiness(userId, biz);

    // DM the new employee
    try {
      await target.send({ embeds: [new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle('💼 New Job Offer!')
        .setDescription(`**${interaction.user.username}** hired you as **${role}** at **${biz.name}**!\n\nYou'll automatically receive **10% of each revenue collection** as your salary.`)
      ]});
    } catch {}

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`👔 ${target.username} Hired!`)
      .setDescription(`**${target.username}** is now your **${role}** at **${biz.name}**.\n\nThey'll earn 10% of every revenue collection automatically.`)
      .addFields({ name: '👥 Staff', value: `${biz.employees.length} / 5`, inline: true })
    ]});
  },
};
