const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getGang, getGangByMember, saveGang, deleteGang, getMemberRank } = require('../../utils/gangDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const GANG_COLORS = ['🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gang')
    .setDescription('Create or manage your gang.')
    .addSubcommand(s => s.setName('create').setDescription('Start a new gang')
      .addStringOption(o => o.setName('name').setDescription('Gang name').setRequired(true))
      .addStringOption(o => o.setName('tag').setDescription('Short tag (2-5 chars)').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Gang color emoji').setRequired(false)
        .addChoices(...GANG_COLORS.map(c => ({ name: c, value: c }))))
    )
    .addSubcommand(s => s.setName('info').setDescription('View your gang or another gang').addStringOption(o => o.setName('name').setDescription('Gang name to look up').setRequired(false)))
    .addSubcommand(s => s.setName('leave').setDescription('Leave your current gang'))
    .addSubcommand(s => s.setName('disband').setDescription('Disband your gang (leader only)'))
    .addSubcommand(s => s.setName('deposit').setDescription('Deposit money into the gang bank').addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName('withdraw').setDescription('Withdraw from gang bank (leader only)').addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'create') {
      const existing = getGangByMember(userId);
      if (existing) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You're already in **${existing.name}**. Leave first.`)], ephemeral: true });

      const name  = interaction.options.getString('name').slice(0, 40);
      const tag   = interaction.options.getString('tag').replace(/[^a-zA-Z0-9]/g,'').slice(0,5).toUpperCase();
      const color = interaction.options.getString('color') || '🔴';
      const cost  = 10000;
      const user  = getOrCreateUser(userId);

      if (user.wallet < cost) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Starting a gang costs **$${cost.toLocaleString()}**. You have **$${user.wallet.toLocaleString()}**.`)], ephemeral: true });

      // Check name taken
      const all = require('../../utils/gangDb').getAllGangs();
      if (Object.values(all).some(g => g.name.toLowerCase() === name.toLowerCase())) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`A gang named **${name}** already exists.`)], ephemeral: true });

      user.wallet -= cost;
      saveUser(userId, user);

      const gangId = `${userId}_${Date.now()}`;
      const gang = {
        id:          gangId,
        name,
        tag:         `[${tag}]`,
        color,
        leaderId:    userId,
        members:     [{ userId, role: 'Leader', rep: 0, joinedAt: Date.now() }],
        bank:        0,
        rep:         0,
        level:       1,
        wins:        0,
        losses:      0,
        kills:       0,
        createdAt:   Date.now(),
        territory:   [],
        allies:      [],
        rivals:      [],
      };
      saveGang(gangId, gang);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle(`${color} ${name} ${gang.tag} — Founded!`)
        .setDescription(`You spent **$${cost.toLocaleString()}** to found **${name}**.\n\nInvite members with \`/ganginvite @user\`.\nStart wars with \`/gangwar challenge\`.`)
        .addFields(
          { name: '👑 Leader',  value: `<@${userId}>`, inline: true },
          { name: '👥 Members', value: '1',            inline: true },
          { name: '💰 Bank',    value: '$0',            inline: true },
        )
      ]});
    }

    if (sub === 'info') {
      const searchName = interaction.options.getString('name');
      let gang;
      if (searchName) {
        const all = require('../../utils/gangDb').getAllGangs();
        gang = Object.values(all).find(g => g.name.toLowerCase().includes(searchName.toLowerCase()));
        if (!gang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`No gang found named **${searchName}**.`)], ephemeral: true });
      } else {
        gang = getGangByMember(userId);
        if (!gang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You're not in a gang. Create one with `/gang create`.")], ephemeral: true });
      }

      const memberLines = gang.members.map(m => {
        const rank = getMemberRank(m.rep);
        return `${gang.color} <@${m.userId}> — ${m.role === 'Leader' ? '👑 Leader' : rank.name} (${m.rep} rep)`;
      }).join('\n');

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle(`${gang.color} ${gang.name} ${gang.tag}`)
        .addFields(
          { name: '👑 Leader',    value: `<@${gang.leaderId}>`,              inline: true },
          { name: '👥 Members',   value: gang.members.length.toString(),      inline: true },
          { name: '🏆 Gang Rep',  value: gang.rep.toString(),                 inline: true },
          { name: '💀 Wins',      value: gang.wins.toString(),                inline: true },
          { name: '☠️ Losses',   value: gang.losses.toString(),              inline: true },
          { name: '💰 Gang Bank', value: `$${gang.bank.toLocaleString()}`,    inline: true },
          { name: '🧑‍🤝‍🧑 Roster', value: memberLines || 'Empty',          inline: false },
        )
        .setFooter({ text: `Level ${gang.level} gang · Founded ${new Date(gang.createdAt).toLocaleDateString()}` })
      ]});
    }

    if (sub === 'leave') {
      const gang = getGangByMember(userId);
      if (!gang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You're not in a gang.")], ephemeral: true });
      if (gang.leaderId === userId) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Leaders can't leave — disband the gang or transfer leadership first.")], ephemeral: true });
      gang.members = gang.members.filter(m => m.userId !== userId);
      saveGang(gang.id, gang);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription(`You left **${gang.name}**.`)] });
    }

    if (sub === 'disband') {
      const gang = getGangByMember(userId);
      if (!gang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You're not in a gang.")], ephemeral: true });
      if (gang.leaderId !== userId) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Only the leader can disband the gang.")], ephemeral: true });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gang_disband_yes').setLabel('Disband').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('gang_disband_no').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('⚠️ Disband Gang?').setDescription(`This will permanently disband **${gang.name}**. The gang bank ($${gang.bank.toLocaleString()}) will be returned to you.`)], components: [row], ephemeral: true });

      const msg       = await interaction.fetchReply();
      const collector = msg.createMessageComponentCollector({ time: 30_000 });
      collector.on('collect', async btn => {
        collector.stop();
        if (btn.customId === 'gang_disband_no') return btn.update({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription('Disband cancelled.')], components: [] });
        const user = getOrCreateUser(userId);
        user.wallet += gang.bank;
        saveUser(userId, user);
        deleteGang(gang.id);
        await btn.update({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('Gang Disbanded').setDescription(`**${gang.name}** has been disbanded. $${gang.bank.toLocaleString()} returned to your wallet.`)], components: [] });
      });
    }

    if (sub === 'deposit') {
      const amount = interaction.options.getInteger('amount');
      const gang   = getGangByMember(userId);
      if (!gang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You're not in a gang.")], ephemeral: true });
      const user = getOrCreateUser(userId);
      if (amount > user.wallet) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You only have **$${user.wallet.toLocaleString()}** in your wallet.`)], ephemeral: true });
      user.wallet -= amount;
      gang.bank   += amount;
      const member = gang.members.find(m => m.userId === userId);
      if (member) { member.rep = (member.rep || 0) + Math.floor(amount / 100); gang.rep = (gang.rep || 0) + Math.floor(amount / 100); }
      saveUser(userId, user);
      saveGang(gang.id, gang);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle('💰 Gang Bank Deposit').setDescription(`You deposited **$${amount.toLocaleString()}** into the **${gang.name}** bank.\n\nGang bank: **$${gang.bank.toLocaleString()}**`)] });
    }

    if (sub === 'withdraw') {
      const amount = interaction.options.getInteger('amount');
      const gang   = getGangByMember(userId);
      if (!gang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You're not in a gang.")], ephemeral: true });
      if (gang.leaderId !== userId) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Only the leader can withdraw from the gang bank.")], ephemeral: true });
      if (amount > gang.bank) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`The gang bank only has **$${gang.bank.toLocaleString()}**.`)], ephemeral: true });
      const user = getOrCreateUser(userId);
      user.wallet += amount;
      gang.bank   -= amount;
      saveUser(userId, user);
      saveGang(gang.id, gang);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(`You withdrew **$${amount.toLocaleString()}** from the gang bank.\n\nGang bank: **$${gang.bank.toLocaleString()}**`)] });
    }
  },
};
