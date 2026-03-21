const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { getConfig } = require('../../utils/db');
const { releaseUser } = require('./jail');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unjail')
    .setDescription('Release a user from jail early.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('User to release').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for early release').setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'Early release by staff';
    const config = getConfig(interaction.guild.id);

    if (!config.prisonRoleId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setDescription('Prison not set up. Run `/jailcreate` first.')], ephemeral:true });

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setDescription('User not found.')], ephemeral:true });

    const role = interaction.guild.roles.cache.get(config.prisonRoleId);
    if (!role || !member.roles.cache.has(role.id)) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff8800).setDescription(`<@${target.id}> is not currently jailed.`)], ephemeral:true });
    }

    await interaction.deferReply();
    await releaseUser(interaction.guild, target.id, config, interaction.user.id);

    return interaction.editReply({ embeds:[new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🟢 User Released')
      .setDescription(`<@${target.id}> has been released from jail.\n**Reason:** ${reason}`)
    ]});
  },
};
