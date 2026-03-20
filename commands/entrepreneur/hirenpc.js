const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getBusiness, saveBusiness } = require('../../utils/bizDb');
const { NPC_POOL, getAvailableNPCs, getNPC, calcNPCScore } = require('../../utils/npcEmployees');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hirenpc')
    .setDescription('Browse and hire NPC employees for your business.'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const userId = interaction.user.id;
    const biz    = getBusiness(userId);

    if (!biz) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a business! Start one with `/business start`.")], ephemeral: true });

    const npcEmployees = (biz.employees || []).filter(e => e.isNPC);
    const available    = getAvailableNPCs(biz.employees || []);

    if (npcEmployees.length >= 6) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You already have 6 NPC employees — the maximum.\nFire one with `/firenpc` to make room.")], ephemeral: true });

    if (!available.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("No NPC employees available right now. Fire existing ones to see new candidates.")], ephemeral: true });

    // Show browse menu
    const page     = 0;
    const pageSize = 3;
    const pages    = Math.ceil(available.length / pageSize);

    const buildEmbed = (p) => {
      const slice = available.slice(p * pageSize, (p + 1) * pageSize);
      const lines = slice.map(npc => {
        const score = calcNPCScore(npc);
        return `${npc.emoji} **${npc.name}** — ${npc.role}\n*${npc.bio}*\n\`Service: ${npc.service} · Management: ${npc.management} · Hustle: ${npc.hustle} · Score: ${score}\`\n💰 Salary: **$${npc.salary.toLocaleString()}/collection**`;
      }).join('\n\n');

      return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🧑‍💼 NPC Employees Available (${p+1}/${pages})`)
        .setDescription(lines || 'No employees on this page.')
        .setFooter({ text: `You have ${npcEmployees.length}/6 NPC slots filled · Slots used also count toward 5-human cap separately` });
    };

    const buildSelect = (p) => {
      const slice = available.slice(p * pageSize, (p + 1) * pageSize);
      return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('hirenpc_select')
          .setPlaceholder('Choose an NPC to hire...')
          .addOptions(slice.map(npc => ({
            label:       `${npc.name} — ${npc.role}`,
            description: `$${npc.salary}/collection · Score: ${calcNPCScore(npc)}`,
            value:       npc.id,
            emoji:       npc.emoji,
          })))
      );
    };

    const buildNav = (p) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`npc_prev_${p}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
      new ButtonBuilder().setCustomId(`npc_next_${p}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= pages - 1),
    );

    let currentPage = 0;
    await interaction.reply({ embeds: [buildEmbed(currentPage)], components: [buildSelect(currentPage), buildNav(currentPage)], ephemeral: true });

    const msg       = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 60_000 });

    collector.on('collect', async i => {
      if (i.user.id !== userId) return i.reply({ content: 'Not your menu.', ephemeral: true });

      if (i.customId === 'hirenpc_select') {
        const npcId  = i.values[0];
        const npc    = getNPC(npcId);
        if (!npc) return i.reply({ content: 'NPC not found.', ephemeral: true });

        const freshBiz = getBusiness(userId);
        const npcCount = (freshBiz.employees || []).filter(e => e.isNPC).length;
        if (npcCount >= 6) return i.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('NPC slots full!')], components: [] });

        const user = getOrCreateUser(userId);
        if (user.wallet < npc.salary * 3) return i.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You need **$${(npc.salary*3).toLocaleString()}** upfront (3 weeks salary) to hire ${npc.name}. You have **$${user.wallet.toLocaleString()}**.`)], components: [] });

        user.wallet -= npc.salary * 3;
        freshBiz.employees = freshBiz.employees || [];
        freshBiz.employees.push({ npcId: npc.id, isNPC: true, role: npc.role, joinedAt: Date.now() });
        saveUser(userId, user);
        await saveBusiness(userId, freshBiz);
        collector.stop();

        return i.update({ embeds: [new EmbedBuilder()
          .setColor(COLORS.SUCCESS)
          .setTitle(`${npc.emoji} ${npc.name} Hired!`)
          .setDescription(`**${npc.name}** (${npc.role}) is now working at **${freshBiz.name}**!\n\n*${npc.bio}*\n\nYou paid 3 weeks upfront: **$${(npc.salary*3).toLocaleString()}**\nThey'll earn $${npc.salary.toLocaleString()} per collection from now on.`)
          .addFields(
            { name: '📊 Service',    value: npc.service.toString(),    inline: true },
            { name: '📊 Management', value: npc.management.toString(), inline: true },
            { name: '📊 Hustle',     value: npc.hustle.toString(),     inline: true },
          )
        ], components: [] });
      }

      if (i.customId.startsWith('npc_prev')) { currentPage = Math.max(0, currentPage - 1); }
      if (i.customId.startsWith('npc_next')) { currentPage = Math.min(pages - 1, currentPage + 1); }
      await i.update({ embeds: [buildEmbed(currentPage)], components: [buildSelect(currentPage), buildNav(currentPage)] });
    });
  },
};
