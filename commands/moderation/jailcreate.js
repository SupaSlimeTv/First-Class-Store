const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { getConfig, saveConfig } = require('../../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jailcreate')
    .setDescription('Create the Prison channel and roles. Run once per server.')
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
        .setDescription(`Prison is already set up!\n\n📍 Channel: <#${config.prisonChannelId}>\n🔒 Prisoner: <@&${config.prisonRoleId}>\n🔕 Solitary: <@&${config.solitaryRoleId||'not set'}>\n\nDelete those manually and run again to reset.`)
      ]});
    }

    try {
      // 1 — Create "Prisoner" role (can talk in prison-chat)
      const prisonerRole = await guild.roles.create({
        name: '🔒 Prisoner',
        color: 0x888888,
        reason: 'First Class Store jail system',
        permissions: [],
      });

      // 2 — Create "Solitary" role (can only READ prison-chat, no talking)
      const solitaryRole = await guild.roles.create({
        name: '🔕 Solitary',
        color: 0x555555,
        reason: 'First Class Store solitary confinement',
        permissions: [],
      });

      // 3 — Deny both roles from viewing ALL existing channels
      for (const [, channel] of guild.channels.cache) {
        if (channel.type === ChannelType.GuildCategory) continue;
        await channel.permissionOverwrites.create(prisonerRole, {
          ViewChannel: false, SendMessages: false,
        }).catch(() => {});
        await channel.permissionOverwrites.create(solitaryRole, {
          ViewChannel: false, SendMessages: false,
        }).catch(() => {});
      }

      // 4 — Create Prison category
      const category = await guild.channels.create({
        name: '🔒 PRISON',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: prisonerRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: solitaryRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        ],
      });

      // 5 — Create ONE #prison-chat channel
      // Prisoner role → can read + send
      // Solitary role → can read only
      const prisonChannel = await guild.channels.create({
        name: '🔒┃prison-chat',
        type: ChannelType.GuildText,
        parent: category.id,
        topic: 'You are serving jail time. Wait it out. Solitary inmates can read but not speak.',
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: prisonerRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: solitaryRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
        ],
      });

      // 6 — Save config
      config.prisonChannelId  = prisonChannel.id;
      config.prisonRoleId     = prisonerRole.id;
      config.solitaryRoleId   = solitaryRole.id;
      config.prisonCategoryId = category.id;
      saveConfig(guild.id, config);

      await prisonChannel.send({ embeds:[new EmbedBuilder()
        .setColor(0x888888)
        .setTitle('🔒 Welcome to Prison')
        .setDescription("You've been jailed. Your sentence will run out automatically.\n\nBehave yourself — disruptive inmates get moved to **Solitary** and can only watch.\n\n*This channel is only visible to prisoners and staff.*")
      ]});

      return interaction.editReply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Prison Created')
        .setDescription(`Prison system is ready!\n\n📍 **Channel:** <#${prisonChannel.id}>\n🔒 **Prisoner Role:** <@&${prisonerRole.id}> — can talk\n🔕 **Solitary Role:** <@&${solitaryRole.id}> — read only\n\nBoth roles are locked out of every other channel.\n\nUse \`/jail @user <minutes> <reason>\` to jail anyone.\nUse \`/solitary @user\` to put a prisoner in solitary.`)
      ]});
    } catch(e) {
      return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setDescription(`Failed: ${e.message}. Make sure I have **Manage Channels** and **Manage Roles** permissions.`)] });
    }
  },
};
