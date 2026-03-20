const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getBusiness, saveBusiness, deleteBusiness, BIZ_TYPES, calcIncome } = require('../../utils/bizDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('business')
    .setDescription('Start, view, or manage your business.')
    .addSubcommand(s => s.setName('start').setDescription('Start a new business')
      .addStringOption(o => o.setName('type').setDescription('Business type').setRequired(true)
        .addChoices(...Object.entries(BIZ_TYPES).map(([id, t]) => ({ name: `${t.emoji} ${t.name} ($${t.baseCost.toLocaleString()})`, value: id })))
      )
      .addStringOption(o => o.setName('name').setDescription('Your business name').setRequired(true))
    )
    .addSubcommand(s => s.setName('view').setDescription('View your business stats'))
    .addSubcommand(s => s.setName('collect').setDescription('Collect your business revenue'))
    .addSubcommand(s => s.setName('upgrade').setDescription('Upgrade your business'))
    .addSubcommand(s => s.setName('close').setDescription('Permanently close your business')),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'start') {
      const existing = getBusiness(userId);
      if (existing && existing.name && existing.type) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ Already Owns a Business').setDescription(`You already own **${existing.name}**!\nSell it first with \`/business close\` before starting another.`)], ephemeral: true });
      // Clean up corrupt/undefined entry if present
      if (existing && (!existing.name || !existing.type)) await deleteBusiness(userId);

      const type     = interaction.options.getString('type');
      const bizName  = interaction.options.getString('name').slice(0, 50);
      const bizType  = BIZ_TYPES[type];
      const user     = getOrCreateUser(userId);

      if (user.wallet < bizType.baseCost) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You need **$${bizType.baseCost.toLocaleString()}** to start a ${bizType.name}. You have **$${user.wallet.toLocaleString()}**.`)], ephemeral: true });

      user.wallet -= bizType.baseCost;
      saveUser(userId, user);

      const biz = {
        id:          `${userId}_${Date.now()}`,
        ownerId:     userId,
        name:        bizName,
        type,
        level:       1,
        employees:   [],           // [{ userId, role, joinedAt }]
        revenue:     0,            // uncollected revenue
        lastTick:    Date.now(),
        totalEarned: 0,
        openedAt:    Date.now(),
        announceChannel: null,
      };
      await saveBusiness(userId, biz);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(`${bizType.emoji} ${bizName} is Open for Business!`)
        .setDescription(`You invested **$${bizType.baseCost.toLocaleString()}** and opened a **${bizType.name}**!\n\n*${bizType.description}*`)
        .addFields(
          { name: '📈 Income Rate',  value: `$${calcIncome(biz).toLocaleString()}/tick`, inline: true },
          { name: '⭐ Level',         value: '1',                                          inline: true },
          { name: '👥 Employees',    value: '0 / 5',                                      inline: true },
        )
        .setFooter({ text: 'Use /business collect to collect revenue · /hire @user to add employees' })
      ]});
    }

    if (sub === 'view') {
      let biz = getBusiness(userId);
      // Fallback: scan all businesses if primary key lookup fails
      if (!biz) {
        const all = require('../../utils/bizDb').getAllBusinesses();
        biz = Object.values(all).find(b => b.ownerId === userId) || null;
      }
      if (!biz) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a business yet! Use `/business start` to open one.")], ephemeral: true });

      const bizType = BIZ_TYPES[biz.type];
      if (!bizType) { await deleteBusiness(userId); return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('🏢 Stale Record Cleared').setDescription('Your old business record was invalid and has been automatically removed.\n\nYou can now use `/business start` to open a new one!')], ephemeral: true }); }
      // Tick revenue up to now
      const now      = Date.now();
      const elapsed  = (now - biz.lastTick) / 1000;
      const perSec   = calcIncome(biz) / 60;
      const pending  = Math.floor(perSec * elapsed) + biz.revenue;

      const upgradeNext = biz.level < bizType.maxLevel
        ? `$${(bizType.upgradeCost * biz.level).toLocaleString()}`
        : 'MAX LEVEL';

      const empList = biz.employees.length
        ? biz.employees.map(e => `<@${e.userId}> — ${e.role}`).join('\n')
        : 'No employees yet';

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(bizType ? parseInt(bizType.emoji.codePointAt(0).toString(16), 16) % 0xFFFFFF : COLORS.INFO)
        .setTitle(`${bizType?.emoji || '🏢'} ${biz.name}`)
        .setDescription(`*${bizType?.description || ''}*`)
        .addFields(
          { name: '💰 Revenue Ready',  value: `$${pending.toLocaleString()}`,                       inline: true },
          { name: '📈 Rate',           value: `$${calcIncome(biz).toLocaleString()}/min`,            inline: true },
          { name: '⭐ Level',          value: `${biz.level} / ${bizType?.maxLevel || 10}`,           inline: true },
          { name: '💸 Next Upgrade',   value: upgradeNext,                                           inline: true },
          { name: '🏆 Total Earned',   value: `$${biz.totalEarned.toLocaleString()}`,                inline: true },
          { name: '👥 Employees',      value: `${biz.employees.length} / 5`,                        inline: true },
          { name: '🧑‍💼 Staff',        value: empList,                                               inline: false },
        )
        .setFooter({ text: 'Use /business collect to cash out · /business upgrade to level up' })
      ]});
    }

    if (sub === 'collect') {
      let biz = getBusiness(userId);
      // Fallback: scan all businesses if primary key lookup fails
      if (!biz) {
        const all = require('../../utils/bizDb').getAllBusinesses();
        biz = Object.values(all).find(b => b.ownerId === userId) || null;
      }
      if (!biz) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a business.")], ephemeral: true });
      if (!biz.type || !BIZ_TYPES[biz.type]) { await deleteBusiness(userId); return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('🏢 Stale Record Cleared').setDescription('Your old business record was invalid and has been automatically removed.\n\nUse `/business start` to open a new one!')], ephemeral: true }); }

      const now     = Date.now();
      const elapsed = (now - biz.lastTick) / 1000;
      const perSec  = calcIncome(biz) / 60;
      const earned  = Math.floor(perSec * elapsed) + biz.revenue;

      if (earned < 1) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription('No revenue to collect yet. Check back in a minute!')], ephemeral: true });

      const user     = getOrCreateUser(userId);
      user.wallet   += earned;
      biz.revenue    = 0;
      biz.lastTick   = now;
      biz.totalEarned += earned;
      saveUser(userId, user);
      await saveBusiness(userId, biz);

      // Pay employees their cut (10% each, from the business not the owner)
      for (const emp of biz.employees) {
        try {
          const empUser    = getOrCreateUser(emp.userId);
          const empCut     = Math.floor(earned * 0.1);
          empUser.wallet  += empCut;
          saveUser(emp.userId, empUser);
        } catch {}
      }

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(`💼 Revenue Collected — ${biz.name}`)
        .setDescription(`You collected **$${earned.toLocaleString()}** from your business!${biz.employees.length ? `\n\nEach employee received a **10% cut** ($${Math.floor(earned * 0.1).toLocaleString()}).` : ''}`)
        .addFields({ name: '💵 New Wallet', value: `$${user.wallet.toLocaleString()}`, inline: true })
      ]});
    }

    if (sub === 'upgrade') {
      // Find business - try direct key first, then scan by ownerId
      const allBiz = require('../../utils/bizDb').getAllBusinesses();
      const biz = allBiz[userId] || Object.values(allBiz).find(b => b.ownerId === userId) || null;

      if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a business. Use `/business start` to open one.")], ephemeral:true });

      const bizType = BIZ_TYPES[biz.type];
      if (!bizType) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Unknown business type: \`${biz.type}\`. Use \`/business close\` then \`/business start\`.`)], ephemeral:true });

      if (biz.level >= bizType.maxLevel) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('Your business is already at **MAX LEVEL**!')], ephemeral:true });

      const cost = bizType.upgradeCost * biz.level;
      const user = getOrCreateUser(userId);
      if (user.wallet < cost) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You need **$${cost.toLocaleString()}** to upgrade. You have **$${user.wallet.toLocaleString()}**.`)], ephemeral:true });

      const oldIncome = calcIncome(biz);
      user.wallet -= cost;
      biz.level++;
      const newIncome = calcIncome(biz);
      saveUser(userId, user);
      await saveBusiness(userId, biz);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`⭐ ${biz.name} — Level ${biz.level}!`)
        .setDescription(`You upgraded your **${bizType.name}** to **Level ${biz.level}**!`)
        .addFields(
          { name:'📈 Income Before', value:`$${oldIncome.toLocaleString()}/min`, inline:true },
          { name:'📈 Income Now',    value:`$${newIncome.toLocaleString()}/min`, inline:true },
          { name:'💵 Wallet',        value:`$${user.wallet.toLocaleString()}`,   inline:true },
        )
      ]});
    }

        if (sub === 'close') {
      const biz = getBusiness(userId);
      if (!biz) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a business.")], ephemeral: true });

      // If business is corrupt (undefined name/type), just delete it immediately
      if (!biz.name || !biz.type) {
        await deleteBusiness(userId);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('🏢 Business Cleared').setDescription('Your corrupt business record has been removed. You can now start a new one with `/business start`.')], ephemeral: true });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('biz_close_confirm').setLabel('Yes, close it').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('biz_close_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('⚠️ Close Business?').setDescription(`Are you sure you want to permanently close **${biz.name}**?\n\nThis cannot be undone. All employees will be let go. You receive no refund.`)], components: [row], ephemeral: true });

      const msg       = await interaction.fetchReply();
      const collector = msg.createMessageComponentCollector({ time: 30_000 });
      collector.on('collect', async btn => {
        collector.stop();
        if (btn.customId === 'biz_close_cancel') return btn.update({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription('Closed business closure. Your business is safe.')], components: [] });
        await deleteBusiness(userId);
        await btn.update({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('🏢 Business Closed').setDescription(`**${biz.name}** has been permanently closed.`)], components: [] });
      });
    }
  },
};
