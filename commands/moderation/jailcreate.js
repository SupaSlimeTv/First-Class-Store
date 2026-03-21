const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { getConfig, saveConfig } = require('../../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jailcreate')
    .setDescription('Create the Prison channel and Prisoner role. Run once per server.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const guild  = interaction.guild;
    const config = getConfig(guild.id);

    if (config.prisonChannelId && config.prisonRoleId) {
      const ch = guild.channels.cache.get(config.prisonChannelId);
      const ro = guild.roles.cache.get(config.prisonRoleId);
      if (ch && ro) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xff8800)
        .setTitle('⚠️ Prison Already Exists')
        .setDescription(`Prison is already set up!\n\n📍 Channel: <#${config.prisonChannelId}>\n🔒 Role: <@&${config.prisonRoleId}>\n\nDelete those manually and run again to reset.`)
      ]});
    }

    try {
      // 1 — Create "Prisoner" role
      const prisonerRole = await guild.roles.create({
        name: '🔒 Prisoner',
        color: 0x888888,
        reason: 'First Class Store jail system',
        permissions: [],
      });

      // 2 — Deny Prisoner role from viewing ALL existing channels
      for (const [, channel] of guild.channels.cache) {
        if (channel.type === ChannelType.GuildCategory) continue;
        await channel.permissionOverwrites.create(prisonerRole, {
          ViewChannel: false, SendMessages: false,
        }).catch(() => {});
      }

      // 3 — Create Prison category
      const category = await guild.channels.create({
        name: '🔒 PRISON',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: prisonerRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        ],
      });

      // 4 — Create #prison-chat under category
      const prisonChannel = await guild.channels.create({
        name: '🔒┃prison-chat',
        type: ChannelType.GuildText,
        parent: category.id,
        topic: 'You are serving jail time. Wait it out or lose your mind.',
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: prisonerRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        ],
      });

      // 5 — Create #solitary (read-only for prisoners)
      await guild.channels.create({
        name: '🔕┃solitary',
        type: ChannelType.GuildText,
        parent: category.id,
        topic: 'No talking. Just time.',
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: prisonerRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
        ],
      });

      // 6 — Save config
      config.prisonChannelId = prisonChannel.id;
      config.prisonRoleId    = prisonerRole.id;
      config.prisonCategoryId= category.id;
      saveConfig(guild.id, config);

      await prisonChannel.send({ embeds:[new EmbedBuilder()
        .setColor(0x888888)
        .setTitle('🔒 Welcome to Prison')
        .setDescription("You've been jailed. Your sentence will run out automatically.\n\nBehave yourself in here.\n\n*This channel is only visible to prisoners and staff.*")
      ]});

      return interaction.editReply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Prison Created')
        .setDescription(`Prison system is ready!\n\n📍 Channel: <#${prisonChannel.id}>\n🔒 Role: <@&${prisonerRole.id}>\n\nThe Prisoner role blocks access to all other channels.\n\nConfigure jail duration in the dashboard under **Police**.\nUse \`/jail @user <minutes> <reason>\` to manually jail anyone.`)
      ]});
    } catch(e) {
      return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setDescription(`Failed to create prison: ${e.message}. Make sure I have **Manage Channels** and **Manage Roles** permissions.`)] });
    }
  },
};
