// commands/moderation/mute.js
const { SlashCommandBuilder } = require('discord.js');
const { hasPermission, PERMISSIONS } = require('../../utils/permissions');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout a member (they can\'t send messages).')
    .addUserOption((o) => o.setName('user').setDescription('User to mute').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('minutes').setDescription('Duration in minutes (max 40320 = 4 weeks)').setMinValue(1).setMaxValue(40320).setRequired(true)
    )
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    if (!hasPermission(interaction.member, PERMISSIONS.MUTE)) {
      return interaction.reply({ embeds: [errorEmbed('You don\'t have permission to mute members.')], ephemeral: true });
    }

    const target = interaction.options.getMember('user');
    const minutes = interaction.options.getInteger('minutes');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target) return interaction.reply({ embeds: [errorEmbed('User not found.')], ephemeral: true });
    if (!target.moderatable) return interaction.reply({ embeds: [errorEmbed('I can\'t mute that user.')], ephemeral: true });

    // Discord timeout takes milliseconds from now
    await target.timeout(minutes * 60 * 1000, reason);

    await interaction.reply({
      embeds: [successEmbed('Member Muted', `**${target.user.username}** was muted for **${minutes} minute(s)**.\nReason: ${reason}`)],
    });
  },
};
