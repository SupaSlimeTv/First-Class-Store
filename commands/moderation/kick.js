// ============================================================
// commands/moderation/kick.js
// Slash command: /kick <user> [reason]
// Requires canKick permission from setmodrole
// ============================================================

const { SlashCommandBuilder } = require('discord.js');
const { hasPermission, PERMISSIONS } = require('../../utils/permissions');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server.')
    .addUserOption((o) =>
      o.setName('user').setDescription('User to kick').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason for kick').setRequired(false)
    ),

  async execute(interaction) {
    // Check custom mod permission
    if (!hasPermission(interaction.member, PERMISSIONS.KICK)) {
      return interaction.reply({
        embeds: [errorEmbed('You don\'t have permission to kick members.')],
        ephemeral: true,
      });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target) {
      return interaction.reply({ embeds: [errorEmbed('User not found in this server.')], ephemeral: true });
    }

    if (!target.kickable) {
      return interaction.reply({ embeds: [errorEmbed('I can\'t kick that user (they may have a higher role than me).')], ephemeral: true });
    }

    await target.kick(reason);
    await interaction.reply({
      embeds: [successEmbed('Member Kicked', `**${target.user.username}** was kicked.\nReason: ${reason}`)],
    });
  },
};
