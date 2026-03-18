// ============================================================
// commands/moderation/setmodrole.js
// Slash command: /setmodrole <role> [permissions...]
// Admins can assign custom permissions to any role
//
// TEACHES: Boolean options, role options, admin-only commands
// ============================================================

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig, saveConfig } = require('../../utils/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setmodrole')
    .setDescription('Assign moderation permissions to a role. (Admin only)')
    // setDefaultMemberPermissions restricts who CAN SEE the command in Discord
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((o) =>
      o.setName('role').setDescription('The role to configure').setRequired(true)
    )
    .addBooleanOption((o) =>
      o.setName('can_purge').setDescription('Can this role start/end the purge?').setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName('can_kick').setDescription('Can this role kick members?').setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName('can_ban').setDescription('Can this role ban members?').setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName('can_mute').setDescription('Can this role timeout members?').setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName('can_warn').setDescription('Can this role warn members?').setRequired(false)
    ),

  async execute(interaction) {
    const role = interaction.options.getRole('role');
    const config = getConfig();

    // Build the permissions object from the options provided
    // If an option wasn't provided (null), keep the existing value or default false
    const existing = config.modRoles[role.id] || {};

    const updated = {
      canPurge: interaction.options.getBoolean('can_purge') ?? existing.canPurge ?? false,
      canKick:  interaction.options.getBoolean('can_kick')  ?? existing.canKick  ?? false,
      canBan:   interaction.options.getBoolean('can_ban')   ?? existing.canBan   ?? false,
      canMute:  interaction.options.getBoolean('can_mute')  ?? existing.canMute  ?? false,
      canWarn:  interaction.options.getBoolean('can_warn')  ?? existing.canWarn  ?? false,
    };
    // ?? is the "nullish coalescing" operator — returns right side if left is null/undefined

    config.modRoles[role.id] = updated;
    saveConfig(config);

    const permList = Object.entries(updated)
      .map(([key, val]) => `${val ? '✅' : '❌'} ${key}`)
      .join('\n');

    await interaction.reply({
      embeds: [
        successEmbed(
          `Mod Role Updated: @${role.name}`,
          `Permissions for **${role.name}**:\n\n${permList}`
        ),
      ],
      ephemeral: true,
    });
  },
};
