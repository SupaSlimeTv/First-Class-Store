// commands/moderation/warn.js
const { SlashCommandBuilder } = require('discord.js');
const { hasPermission, PERMISSIONS } = require('../../utils/permissions');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const fs = require('fs');
const path = require('path');

const WARNS_FILE = path.join(__dirname, '../../data/warnings.json');

function getWarnings() {
  if (!fs.existsSync(WARNS_FILE)) return {};
  return JSON.parse(fs.readFileSync(WARNS_FILE, 'utf8'));
}
function saveWarnings(data) {
  fs.writeFileSync(WARNS_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member. Warnings are logged.')
    .addUserOption((o) => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for warning').setRequired(true)),

  async execute(interaction) {
    if (!hasPermission(interaction.member, PERMISSIONS.WARN)) {
      return interaction.reply({ embeds: [errorEmbed('You don\'t have permission to warn members.')], ephemeral: true });
    }

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    const warnings = getWarnings();
    if (!warnings[target.id]) warnings[target.id] = [];

    warnings[target.id].push({
      reason,
      moderator: interaction.user.id,
      timestamp: new Date().toISOString(),
    });

    saveWarnings(warnings);
    const count = warnings[target.id].length;

    await interaction.reply({
      embeds: [successEmbed('Member Warned', `**${target.username}** has been warned.\nReason: ${reason}\nTotal warnings: **${count}**`)],
    });

    // Try to DM the warned user
    try {
      await target.send(`⚠️ You have been warned in **${interaction.guild.name}**.\nReason: ${reason}\nTotal warnings: ${count}`);
    } catch {
      // User has DMs closed — ignore silently
    }
  },
};
