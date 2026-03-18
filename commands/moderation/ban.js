// commands/moderation/ban.js
const { SlashCommandBuilder } = require('discord.js');
const { hasPermission, PERMISSIONS } = require('../../utils/permissions');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server.')
    .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
    .addIntegerOption((o) =>
      o.setName('delete_days').setDescription('Delete message history (days, 0-7)').setMinValue(0).setMaxValue(7).setRequired(false)
    ),

  async execute(interaction) {
    if (!hasPermission(interaction.member, PERMISSIONS.BAN)) {
      return interaction.reply({ embeds: [errorEmbed('You don\'t have permission to ban members.')], ephemeral: true });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0;

    if (!target) return interaction.reply({ embeds: [errorEmbed('User not found.')], ephemeral: true });
    if (!target.bannable) return interaction.reply({ embeds: [errorEmbed('I can\'t ban that user.')], ephemeral: true });

    await target.ban({ deleteMessageDays: deleteDays, reason });
    await interaction.reply({
      embeds: [successEmbed('Member Banned', `**${target.user.username}** was banned.\nReason: ${reason}`)],
    });
  },
};
