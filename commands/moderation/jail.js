const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { getConfig, saveConfig } = require('../../utils/db');
const { getPoliceRecord, savePoliceRecord, isJailed } = require('../../utils/gangDb');

async function jailUser(guild, userId, durationMinutes, reason, config, jailedBy) {
  const role    = config.prisonRoleId ? guild.roles.cache.get(config.prisonRoleId) : null;
  const channel = config.prisonChannelId ? guild.channels.cache.get(config.prisonChannelId) : null;
  if (!role || !channel) return { ok: false, error: 'Prison not set up. Run `/jailcreate` first.' };

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, error: 'User not found in server.' };

  // Store pre-jail roles (excluding managed roles) so we can restore them on release
  const rolesBeforeJail = member.roles.cache
    .filter(r => !r.managed && r.id !== guild.roles.everyone.id && r.id !== role.id)
    .map(r => r.id);

  // Update police record
  const rec = getPoliceRecord(userId);
  rec.jailUntil   = Date.now() + durationMinutes * 60 * 1000;
  rec.jailReason  = reason || 'Jailed by staff';
  rec.jailDuration= durationMinutes;
  rec.rolesBeforeJail = rolesBeforeJail;
  await savePoliceRecord(userId, rec);

  // Apply prisoner role — optionally strip other roles to really lock them down
  try {
    await member.roles.add(role, `Jailed: ${reason}`);
  } catch(e) { return { ok: false, error: `Failed to add Prisoner role: ${e.message}` }; }

  // Notify prison channel
  await channel.send({ embeds:[new EmbedBuilder()
    .setColor(0xff3b3b)
    .setTitle('🚔 New Inmate')
    .setDescription(`<@${userId}> has been locked up!\n\n**Reason:** ${reason || 'No reason given'}\n**Sentence:** ${durationMinutes} minute${durationMinutes !== 1 ? 's' : ''}\n**Jailed by:** ${jailedBy ? `<@${jailedBy}>` : 'Automatic'}`)
    .setFooter({ text: `Release: ${new Date(rec.jailUntil).toLocaleTimeString()}` })
  ]});

  // DM the user
  const dmEmbed = new EmbedBuilder()
    .setColor(0xff3b3b)
    .setTitle(`🔒 You've Been Jailed in ${guild.name}`)
    .setDescription(`**Reason:** ${reason || 'No reason given'}\n**Duration:** ${durationMinutes} minute${durationMinutes !== 1 ? 's' : ''}\n\nYou can only access the prison chat until your sentence is up.`)
    .setFooter({ text: 'Stay out of trouble next time.' });

  await member.send({ embeds:[dmEmbed] }).catch(() => {});

  return { ok: true, rec, member };
}

async function releaseUser(guild, userId, config, releasedBy) {
  const role   = config.prisonRoleId ? guild.roles.cache.get(config.prisonRoleId) : null;
  const channel= config.prisonChannelId ? guild.channels.cache.get(config.prisonChannelId) : null;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  // Remove prisoner role
  if (role) await member.roles.remove(role, 'Jail sentence complete').catch(() => {});

  // Clear jail record
  const rec = getPoliceRecord(userId);
  rec.jailUntil = null;
  rec.jailReason = null;
  await savePoliceRecord(userId, rec);

  if (channel) {
    await channel.send({ embeds:[new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🟢 Inmate Released')
      .setDescription(`<@${userId}> has been released.${releasedBy ? ` Released by <@${releasedBy}>.` : ' Sentence complete.'}`)
    ]});
  }

  // DM user
  await member.send({ embeds:[new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🟢 You\'ve Been Released')
    .setDescription(`You have been released from jail in **${guild.name}**. Don't end up back here.`)
  ]}).catch(() => {});
}

module.exports = {
  jailUser,
  releaseUser,

  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription('Jail a user — restricts them to the prison channel.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('User to jail').setRequired(true))
    .addIntegerOption(o => o.setName('duration').setDescription('Jail time in minutes (default 10)').setRequired(false).setMinValue(1).setMaxValue(10080))
    .addStringOption(o => o.setName('reason').setDescription('Reason for jailing').setRequired(false).setMaxLength(200)),

  async execute(interaction) {
    const target   = interaction.options.getUser('user');
    const duration = interaction.options.getInteger('duration') || 10;
    const reason   = interaction.options.getString('reason') || 'Jailed by staff';
    const config   = getConfig(interaction.guild.id);

    if (!config.prisonRoleId || !config.prisonChannelId) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setDescription('Prison not set up. Run `/jailcreate` first.')], ephemeral:true });
    }

    if (target.id === interaction.user.id) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setDescription("You can't jail yourself.")], ephemeral:true });

    await interaction.deferReply();
    const result = await jailUser(interaction.guild, target.id, duration, reason, config, interaction.user.id);

    if (!result.ok) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setDescription(`❌ ${result.error}`)] });

    return interaction.editReply({ embeds:[new EmbedBuilder()
      .setColor(0xff3b3b)
      .setTitle('🔒 User Jailed')
      .setDescription(`<@${target.id}> has been sent to prison.`)
      .addFields(
        { name:'⏱️ Duration', value:`${duration} minute${duration!==1?'s':''}`, inline:true },
        { name:'📋 Reason',   value:reason,                                       inline:true },
        { name:'📍 Prison',   value:`<#${config.prisonChannelId}>`,               inline:true },
      )
    ]});
  },
};
