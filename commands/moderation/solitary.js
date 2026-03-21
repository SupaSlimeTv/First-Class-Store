const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { getConfig } = require('../../utils/db');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('solitary')
    .setDescription('Move a prisoner to solitary — they can only read prison-chat, not speak.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Prisoner to put in solitary').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'Disruptive behavior';
    const config = getConfig(interaction.guild.id);

    if (!config.prisonRoleId || !config.solitaryRoleId) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('Prison not set up or solitary role missing. Run `/jailcreate` first.')
      ], ephemeral:true });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('User not found.')], ephemeral:true });

    const prisonerRole = interaction.guild.roles.cache.get(config.prisonRoleId);
    const solitaryRole = interaction.guild.roles.cache.get(config.solitaryRoleId);

    if (!prisonerRole || !solitaryRole) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Roles not found. Re-run `/jailcreate`.')], ephemeral:true });
    }

    const inSolitary = member.roles.cache.has(solitaryRole.id);

    if (inSolitary) {
      // Remove from solitary back to regular prisoner
      await member.roles.remove(solitaryRole, 'Released from solitary');
      if (!member.roles.cache.has(prisonerRole.id)) {
        await member.roles.add(prisonerRole, 'Returned from solitary');
      }

      // Announce in prison chat
      const channel = interaction.guild.channels.cache.get(config.prisonChannelId);
      if (channel) await channel.send({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
        .setDescription(`🔕 → 🔒 <@${target.id}> has been released from solitary.`)
      ]});

      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
        .setDescription(`<@${target.id}> released from solitary — back to regular prison.`)
      ]});
    } else {
      // Put in solitary — swap prisoner role for solitary role
      if (member.roles.cache.has(prisonerRole.id)) {
        await member.roles.remove(prisonerRole, 'Moved to solitary');
      }
      await member.roles.add(solitaryRole, `Solitary: ${reason}`);

      // Announce in prison chat
      const channel = interaction.guild.channels.cache.get(config.prisonChannelId);
      if (channel) await channel.send({ embeds:[new EmbedBuilder().setColor(0xff8800)
        .setTitle('🔕 Solitary Confinement')
        .setDescription(`<@${target.id}> has been placed in **solitary**.\n**Reason:** ${reason}\n\n*They can read this channel but can no longer speak.*`)
      ]});

      // DM the user
      await target.send({ embeds:[new EmbedBuilder().setColor(0xff8800)
        .setTitle('🔕 Placed in Solitary')
        .setDescription(`You have been placed in **solitary confinement** in **${interaction.guild.name}**.\n\n**Reason:** ${reason}\n\nYou can still read the prison chat but you cannot send messages.`)
      ]}).catch(() => {});

      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff8800)
        .setTitle('🔕 Solitary Applied')
        .setDescription(`<@${target.id}> moved to solitary.\n**Reason:** ${reason}`)
      ]});
    }
  },
};
