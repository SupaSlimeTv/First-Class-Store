const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUser } = require('../../utils/db');
const { getGangByMember, saveGang } = require('../../utils/gangDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ganginvite')
    .setDescription('Invite a user to your gang.')
    .addUserOption(o => o.setName('user').setDescription('Who to invite').setRequired(true)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const target = interaction.options.getUser('user');
    const userId = interaction.user.id;

    if (target.id === userId) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't invite yourself.")], ephemeral: true });
    if (target.bot) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't invite a bot.")], ephemeral: true });

    const gang = getGangByMember(userId);
    if (!gang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You're not in a gang.")], ephemeral: true });
    if (gang.leaderId !== userId && !gang.members.find(m => m.userId === userId && m.role === 'Officer')) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Only the leader or officers can invite members.")], ephemeral: true });
    }
    if (gang.members.length >= 20) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Your gang is full (20 members max).")], ephemeral: true });
    if (getGangByMember(target.id)) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`**${target.username}** is already in a gang.`)], ephemeral: true });

    const targetData = getUser(target.id);
    if (!targetData) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`**${target.username}** doesn't have an account yet.`)], ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ginvite_accept_${gang.id}`).setLabel('✅ Join').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ginvite_decline').setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
    );

    await interaction.reply({
      content: `<@${target.id}>`,
      embeds: [new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle(`${gang.color} Gang Invite — ${gang.name} ${gang.tag}`)
        .setDescription(`**${interaction.user.username}** is inviting you to join **${gang.name}**!\n\n👥 ${gang.members.length} members · 🏆 ${gang.rep} rep\n\nDo you accept?`)
        .setFooter({ text: 'Invite expires in 60 seconds' })
      ],
      components: [row],
    });

    const msg       = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 60_000 });

    collector.on('collect', async btn => {
      if (btn.user.id !== target.id) return btn.reply({ content: "This invite isn't for you.", ephemeral: true });
      collector.stop();

      if (btn.customId === 'ginvite_decline') {
        return btn.update({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription(`**${target.username}** declined the invite.`)], components: [] });
      }

      // Check again they're not in a gang
      if (getGangByMember(target.id)) return btn.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You joined a different gang while this invite was pending.")], components: [] });

      const freshGang = getGangByMember(userId);
      if (!freshGang) return btn.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("The gang no longer exists.")], components: [] });

      freshGang.members.push({ userId: target.id, role: 'Member', rep: 0, joinedAt: Date.now() });
      saveGang(freshGang.id, freshGang);

      await btn.update({ embeds: [new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(`${freshGang.color} Welcome to ${freshGang.name}!`)
        .setDescription(`<@${target.id}> joined **${freshGang.name}** ${freshGang.tag}!\n\n👥 ${freshGang.members.length} members now.`)
      ], components: [] });
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
