const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getBusinesses, getBusinessById, saveBusiness, BIZ_TYPES } = require('../../utils/bizDb');
const { NPC_POOL, getAvailableNPCs, getNPC, calcNPCScore } = require('../../utils/npcEmployees');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hirenpc')
    .setDescription('Browse and hire NPC employees for your business.')
    .addStringOption(o => o
      .setName('business')
      .setDescription('Which business to hire for (required if you own multiple)')
      .setRequired(false)
      .setAutocomplete(true)),

  async autocomplete(interaction) {
    const userId  = interaction.user.id;
    const focused = interaction.options.getFocused().toLowerCase();
    const allBiz  = getBusinesses(userId);

    const matches = allBiz
      .filter(b => {
        const typeName = BIZ_TYPES[b.type]?.name || b.type;
        return b.name?.toLowerCase().includes(focused) || typeName.toLowerCase().includes(focused);
      })
      .slice(0, 25)
      .map(b => {
        const def      = BIZ_TYPES[b.type] || {};
        const npcCount = (b.employees || []).filter(e => e.isNPC).length;
        return {
          name: `${def.emoji || '🏢'} ${b.name} (${def.name || b.type}) — ${npcCount}/5 NPCs`.slice(0, 100),
          value: b.id,
        };
      });

    return interaction.respond(matches).catch(() => null);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const userId    = interaction.user.id;
    const allBiz    = getBusinesses(userId);

    if (!allBiz.length) return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a business. Start one with `/business start`.")],
      ephemeral: true,
    });

    // Resolve which business to use
    const bizId = interaction.options.getString('business');
    let biz;

    if (bizId) {
      biz = allBiz.find(b => b.id === bizId);
      if (!biz) return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Business not found. Use the autocomplete to pick one.")],
        ephemeral: true,
      });
    } else if (allBiz.length === 1) {
      biz = allBiz[0];
    } else {
      // Multiple businesses, none specified — show a picker first
      const opts = allBiz.slice(0, 25).map(b => {
        const def      = BIZ_TYPES[b.type] || {};
        const npcCount = (b.employees || []).filter(e => e.isNPC).length;
        return {
          label:       `${b.name} (${def.name || b.type})`.slice(0, 100),
          description: `${npcCount}/5 NPC slots used · Lv${b.level || 1}`,
          value:       b.id,
          emoji:       def.emoji || '🏢',
        };
      });

      const menu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('hirenpc_biz_pick')
          .setPlaceholder('Choose which business to hire for...')
          .addOptions(opts)
      );

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🏢 Choose a Business')
          .setDescription('You own multiple businesses. Pick which one you want to hire an NPC for.\n\n' +
            allBiz.map(b => {
              const def = BIZ_TYPES[b.type] || {};
              const npc = (b.employees || []).filter(e => e.isNPC).length;
              return `${def.emoji || '🏢'} **${b.name}** — Lv${b.level || 1} · ${npc}/5 NPC slots`;
            }).join('\n'))
        ],
        components: [menu],
        ephemeral: true,
      });

      const msg  = await interaction.fetchReply();
      const pick = await msg.awaitMessageComponent({ filter: i => i.user.id === userId && i.customId === 'hirenpc_biz_pick', time: 60_000 }).catch(() => null);
      if (!pick) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription('Timed out.')], components: [] });

      biz = allBiz.find(b => b.id === pick.values[0]);
      if (!biz) return pick.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Business not found.')], components: [] });
      await pick.update({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription(`Loading NPC roster for **${biz.name}**...`)], components: [] });
    }

    // ── NPC HIRING FLOW ──────────────────────────────────────
    await openNPCBrowser(interaction, userId, biz, !!bizId || allBiz.length === 1);
  },
};

async function openNPCBrowser(interaction, userId, biz, isFirstReply) {
  const npcEmployees = (biz.employees || []).filter(e => e.isNPC);
  const available    = getAvailableNPCs(biz.employees || []);
  const totalStaff   = (biz.employees || []).length;
  const def          = BIZ_TYPES[biz.type] || {};

  const replyFn = (opts) => isFirstReply
    ? interaction.reply({ ...opts, ephemeral: true })
    : interaction.editReply(opts);

  if (npcEmployees.length >= 5) return replyFn({
    embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription(`**${biz.name}** already has 5 NPC employees — the max. Use \`/firenpc\` to make room.`)],
    components: [],
  });
  if (totalStaff >= 10) return replyFn({
    embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription(`**${biz.name}** is at the 10-employee cap. Fire someone first.`)],
    components: [],
  });
  if (!available.length) return replyFn({
    embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription('No NPC employees available right now. Fire existing ones to see new candidates.')],
    components: [],
  });

  const pageSize = 3;
  const pages    = Math.ceil(available.length / pageSize);
  let   curPage  = 0;

  const buildEmbed = (p) => {
    const slice = available.slice(p * pageSize, (p + 1) * pageSize);
    const lines = slice.map(npc => {
      const score = calcNPCScore(npc);
      return `${npc.emoji} **${npc.name}** — ${npc.role}\n*${npc.bio}*\n\`Service: ${npc.service} · Mgmt: ${npc.management} · Hustle: ${npc.hustle} · Score: ${score}\`\n💰 Salary: **$${npc.salary.toLocaleString()}/collection**`;
    }).join('\n\n');

    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${def.emoji || '🏢'} ${biz.name} — Hire an NPC (${p + 1}/${pages})`)
      .setDescription(lines || 'No employees on this page.')
      .setFooter({ text: `NPC slots: ${npcEmployees.length}/5 · Total staff: ${totalStaff}/10` });
  };

  const buildSelect = (p) => {
    const slice = available.slice(p * pageSize, (p + 1) * pageSize);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('hirenpc_select')
        .setPlaceholder('Choose an NPC to hire...')
        .addOptions(slice.map(npc => ({
          label:       `${npc.name} — ${npc.role}`.slice(0, 100),
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

  await replyFn({ embeds: [buildEmbed(0)], components: [buildSelect(0), buildNav(0)] });

  const msg       = await interaction.fetchReply();
  const collector = msg.createMessageComponentCollector({ time: 60_000 });

  collector.on('collect', async i => {
    if (i.user.id !== userId) return i.reply({ content: 'Not your menu.', ephemeral: true });

    if (i.customId === 'hirenpc_select') {
      const npcId = i.values[0];
      const npc   = getNPC(npcId);
      if (!npc) return i.reply({ content: 'NPC not found.', ephemeral: true });

      // Re-fetch fresh biz to avoid stale data
      const freshList = getBusinesses(userId);
      const freshBiz  = freshList.find(b => b.id === biz.id) || biz;
      const freshNPCs = (freshBiz.employees || []).filter(e => e.isNPC).length;

      if (freshNPCs >= 5) return i.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`**${freshBiz.name}** NPC slots full (5/5).`)], components: [] });
      if ((freshBiz.employees || []).length >= 10) return i.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`**${freshBiz.name}** is at the 10-employee cap.`)], components: [] });

      const user = getOrCreateUser(userId);
      if (user.wallet < npc.salary * 3) return i.update({
        embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`You need **$${(npc.salary * 3).toLocaleString()}** upfront (3 weeks salary) to hire ${npc.name}. You have **$${user.wallet.toLocaleString()}**.`)],
        components: [],
      });

      user.wallet -= npc.salary * 3;
      freshBiz.employees = freshBiz.employees || [];
      freshBiz.employees.push({ npcId: npc.id, isNPC: true, role: npc.role, joinedAt: Date.now() });
      saveUser(userId, user);
      await saveBusiness(userId, freshBiz);
      collector.stop();

      return i.update({
        embeds: [new EmbedBuilder()
          .setColor(COLORS.SUCCESS)
          .setTitle(`${npc.emoji} ${npc.name} Hired!`)
          .setDescription(`**${npc.name}** (${npc.role}) is now working at **${freshBiz.name}**!\n\n*${npc.bio}*\n\nUpfront: **$${(npc.salary * 3).toLocaleString()}** · Ongoing: $${npc.salary.toLocaleString()}/collection`)
          .addFields(
            { name: '📊 Service',    value: `${npc.service}`,    inline: true },
            { name: '📊 Management', value: `${npc.management}`, inline: true },
            { name: '📊 Hustle',     value: `${npc.hustle}`,     inline: true },
          )
        ],
        components: [],
      });
    }

    if (i.customId.startsWith('npc_prev')) curPage = Math.max(0, curPage - 1);
    if (i.customId.startsWith('npc_next')) curPage = Math.min(pages - 1, curPage + 1);
    await i.update({ embeds: [buildEmbed(curPage)], components: [buildSelect(curPage), buildNav(curPage)] });
  });
}
