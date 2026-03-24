// ============================================================
// commands/entrepreneur/business.js
// Rules:
//   • ALL users: 1 legit business max
//   • Gang owners only: up to 3 cash/laundering businesses
// ============================================================
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const {
  getBusiness, getBusinesses, getCashBusinesses, getBusinessByType,
  saveBusiness, deleteBusiness, BIZ_TYPES, calcIncome
} = require('../../utils/bizDb');
const { getGangByMember } = require('../../utils/gangDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const { bizTypeAutocomplete } = require('../../utils/autocomplete');

const CASH_MAX = 3; // max laundering businesses for gang owners

module.exports = {
  data: new SlashCommandBuilder()
    .setName('business')
    .setDescription('Start, view, or manage your business.')
    .addSubcommand(s => s.setName('start').setDescription('Start a new business')
      .addStringOption(o => o.setName('type').setAutocomplete(true).setDescription('Business type').setRequired(true)
        .addChoices(...Object.entries(BIZ_TYPES).map(([id,t]) => ({ name:`${t.emoji} ${t.name} ($${t.baseCost.toLocaleString()})`, value:id }))))
      .addStringOption(o => o.setName('name').setDescription('Your business name').setRequired(true)))
    .addSubcommand(s => s.setName('view').setDescription('View your businesses')
      .addStringOption(o => o.setName('type').setAutocomplete(true).setDescription('Which business to view (leave blank for your main legit one)').setRequired(false)
        .addChoices(...Object.entries(BIZ_TYPES).map(([id,t]) => ({ name:`${t.emoji} ${t.name}`, value:id })))))
    .addSubcommand(s => s.setName('collect').setDescription('Collect revenue from a business')
      .addStringOption(o => o.setName('type').setAutocomplete(true).setDescription('Which business to collect from (leave blank for legit)').setRequired(false)
        .addChoices(...Object.entries(BIZ_TYPES).map(([id,t]) => ({ name:`${t.emoji} ${t.name}`, value:id })))))
    .addSubcommand(s => s.setName('upgrade').setDescription('Upgrade a business')
      .addStringOption(o => o.setName('type').setAutocomplete(true).setDescription('Which business to upgrade (leave blank for legit)').setRequired(false)
        .addChoices(...Object.entries(BIZ_TYPES).map(([id,t]) => ({ name:`${t.emoji} ${t.name}`, value:id })))))
    .addSubcommand(s => s.setName('list').setDescription('List all your businesses'))
    .addSubcommand(s => s.setName('close').setDescription('Permanently close a business')
      .addStringOption(o => o.setName('type').setAutocomplete(true).setDescription('Which business to close').setRequired(true)
        .addChoices(...Object.entries(BIZ_TYPES).map(([id,t]) => ({ name:`${t.emoji} ${t.name}`, value:id }))))),


  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'type') return bizTypeAutocomplete(interaction);
  },
  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // ── START ─────────────────────────────────────────────────
    if (sub === 'start') {
      const type    = interaction.options.getString('type');
      const bizName = interaction.options.getString('name').slice(0, 50);
      const bizType = BIZ_TYPES[type];
      if (!bizType) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Invalid business type.')], ephemeral:true });

      const isCash = !!bizType.isCashBusiness;

      // ── LEGIT: max 1 (or 2 for Illuminati members) ──
      if (!isCash) {
        const existing = getBusiness(userId);
        if (existing) {
          // Check if Illuminati member — they get 2 legit biz slots
          const { isMember: isIllumMember } = require('../../utils/illuminatiDb');
          const hasIllumSlot = isIllumMember(interaction.guildId, userId);
          if (!hasIllumSlot) {
            return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
              .setTitle('❌ Already have a legit business')
              .setDescription(`You already own **${existing.name}** (${BIZ_TYPES[existing.type]?.name}).\n\nClose it first with \`/business close type:${existing.type}\` before starting another.\n\n*🔺 Illuminati members can own 2 legit businesses.*`)
            ], ephemeral:true });
          }
          // They're Illuminati — check they don't already have 2
          const { getAllBusinesses } = require('../../utils/bizDb');
          const allBiz  = getAllBusinesses();
          const myLegit = Object.values(allBiz).flat().filter(b => b.ownerId === userId && !BIZ_TYPES[b.type]?.isCashBusiness);
          if (myLegit.length >= 2) {
            return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
              .setTitle('❌ Business Limit Reached')
              .setDescription(`Even Illuminati members are capped at **2 legit businesses**. Close one first.`)
            ], ephemeral:true });
          }
        }
      }

      // ── CASH: gang owners only, max 3 ──
      if (isCash) {
        const gang = getGangByMember(userId);
        if (!gang || gang.leaderId !== userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setTitle('🏴 Gang Leader Only')
          .setDescription('Cash/laundering businesses can only be opened by **gang leaders**.\n\nCreate or lead a gang first.')
        ], ephemeral:true });

        const cashBizs = getCashBusinesses(userId);
        if (cashBizs.length >= CASH_MAX) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setTitle(`❌ Max ${CASH_MAX} Cash Businesses`)
          .setDescription(`You already own **${cashBizs.length}** cash businesses (max ${CASH_MAX}).\n\nClose one with \`/business close type:\` before opening another.`)
        ], ephemeral:true });

        // Can't own same type twice
        if (getBusinessByType(userId, type)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`You already own a **${bizType.name}**. Each type can only be opened once.`)
        ], ephemeral:true });
      }

      const user = getOrCreateUser(userId);
      if (user.wallet < bizType.baseCost) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You need **$${bizType.baseCost.toLocaleString()}** to start a ${bizType.name}. You have **$${user.wallet.toLocaleString()}**.`)
      ], ephemeral:true });

      user.wallet -= bizType.baseCost;
      saveUser(userId, user);

      const biz = {
        id: `${userId}_${type}_${Date.now()}`,
        ownerId: userId, name: bizName, type,
        level: 1, employees: [], revenue: 0,
        lastTick: Date.now(), totalEarned: 0, openedAt: Date.now(),
      };
      await saveBusiness(userId, biz);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(`${bizType.emoji} ${bizName} is Open!`)
        .setDescription(`Invested **$${bizType.baseCost.toLocaleString()}** — **${bizType.name}** is open!\n\n*${bizType.description}*${isCash ? '\n\n🏴 **Gang cash business** — use `/launder` to push dirty money through here.' : ''}`)
        .addFields(
          { name:'📈 Income',    value:`$${calcIncome(biz).toLocaleString()}/min`, inline:true },
          { name:'⭐ Level',     value:'1',                                          inline:true },
          { name:'👥 Employees', value:'0 / 5',                                      inline:true },
        )
        .setFooter({ text:`${isCash?'Cash business · gang leader only · ':''}/business collect type:${type}` })
      ]});
    }

    // ── LIST ──────────────────────────────────────────────────
    if (sub === 'list') {
      const all = getBusinesses(userId);
      if (!all.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription("You don't own any businesses. Use `/business start` to open one.")
      ], ephemeral:true });

      const legit = all.filter(b => BIZ_TYPES[b.type]?.isLegit || !BIZ_TYPES[b.type]?.isCashBusiness);
      const cash  = all.filter(b => BIZ_TYPES[b.type]?.isCashBusiness);

      const fmt = (b) => {
        const bt = BIZ_TYPES[b.type];
        const now = Date.now();
        const pending = Math.floor(calcIncome(b)/60 * (now-b.lastTick)/1000) + (b.revenue||0);
        return `${bt?.emoji||'🏢'} **${b.name}** (${bt?.name}) — Lvl ${b.level} · $${pending.toLocaleString()} ready`;
      };

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xff6b35)
        .setTitle('🏢 Your Businesses')
        .addFields(
          ...(legit.length ? [{ name:'✅ Legit', value:legit.map(fmt).join('\n'), inline:false }] : []),
          ...(cash.length  ? [{ name:`💸 Cash Fronts (${cash.length}/${CASH_MAX})`, value:cash.map(fmt).join('\n'), inline:false }] : []),
          { name:'📋 Tip', value:'`/business view type:` · `/business collect type:` · `/business upgrade type:`', inline:false },
        )
      ]});
    }

    // ── VIEW ──────────────────────────────────────────────────
    if (sub === 'view') {
      const type = interaction.options.getString('type');
      const biz  = type ? getBusinessByType(userId, type) : getBusiness(userId);
      if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(type ? `You don't own a **${BIZ_TYPES[type]?.name||type}**.` : "You don't own a legit business.")
      ], ephemeral:true });

      const bizType = BIZ_TYPES[biz.type];
      const pending = Math.floor(calcIncome(biz)/60 * (Date.now()-biz.lastTick)/1000) + (biz.revenue||0);
      const upgradeNext = biz.level < bizType.maxLevel ? `$${(bizType.upgradeCost * biz.level).toLocaleString()}` : 'MAX';

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(bizType?.isCashBusiness ? 0x888888 : 0xff6b35)
        .setTitle(`${bizType?.emoji||'🏢'} ${biz.name}`)
        .setDescription(`*${bizType?.description||''}*`)
        .addFields(
          { name:'💰 Revenue Ready',  value:`$${pending.toLocaleString()}`,               inline:true },
          { name:'📈 Rate',           value:`$${calcIncome(biz).toLocaleString()}/min`,   inline:true },
          { name:'⭐ Level',          value:`${biz.level} / ${bizType?.maxLevel||10}`,    inline:true },
          { name:'💸 Next Upgrade',   value:upgradeNext,                                  inline:true },
          { name:'🏆 Total Earned',   value:`$${(biz.totalEarned||0).toLocaleString()}`,  inline:true },
          { name:'👥 Employees', value:(() => {
            const all   = biz.employees||[];
            const human = all.filter(e=>!e.isNPC).length;
            const npc   = all.filter(e=>e.isNPC).length;
            return `👤 ${human}/5 · 🤖 ${npc}/6`;
          })(), inline:true },
          { name:'🧑‍💼 Staff', value:(() => {
            if (!(biz.employees||[]).length) return 'None';
            return biz.employees.map(e => {
              if (e.isNPC) {
                const { getNPC } = require('../../utils/npcEmployees');
                const npc = getNPC ? getNPC(e.npcId) : null;
                return `${npc?.emoji||'🤖'} **${npc?.name||e.npcId}** — ${e.role} *(NPC)*`;
              }
              return `<@${e.userId}> — ${e.role}`;
            }).join('\n');
          })(), inline:false },
        )
        .setFooter({ text:`/business collect type:${biz.type} · /business upgrade type:${biz.type}` })
      ]});
    }

    // ── COLLECT ───────────────────────────────────────────────
    if (sub === 'collect') {
      const type = interaction.options.getString('type');
      const biz  = type ? getBusinessByType(userId, type) : getBusiness(userId);
      if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(type ? `You don't own a **${BIZ_TYPES[type]?.name||type}**.` : "You don't own a legit business. Use `/business list` to see all your businesses.")
      ], ephemeral:true });
      if (!BIZ_TYPES[biz.type]) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Invalid business type. Use `/business close` to clean it up.')], ephemeral:true });

      const now    = Date.now();
      const earned = Math.floor(calcIncome(biz)/60 * (now-biz.lastTick)/1000) + (biz.revenue||0);
      if (earned < 1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('No revenue to collect yet.')], ephemeral:true });

      const user = getOrCreateUser(userId);
      user.wallet += earned;
      biz.revenue = 0; biz.lastTick = now; biz.totalEarned = (biz.totalEarned||0) + earned;
      saveUser(userId, user);
      await saveBusiness(userId, biz);

      for (const emp of (biz.employees||[])) {
        try {
          const eu = getOrCreateUser(emp.userId);
          eu.wallet += Math.floor(earned * 0.1);
          saveUser(emp.userId, eu);
        } catch {}
      }

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(`💼 Revenue Collected — ${biz.name}`)
        .setDescription(`Collected **$${earned.toLocaleString()}** from **${biz.name}**!${(biz.employees||[]).length ? `\n\nEach employee got a 10% cut ($${Math.floor(earned*0.1).toLocaleString()}).` : ''}`)
        .addFields({ name:'💵 Wallet', value:`$${user.wallet.toLocaleString()}`, inline:true })
      ]});
    }

    // ── UPGRADE ───────────────────────────────────────────────
    if (sub === 'upgrade') {
      const type = interaction.options.getString('type');
      const biz  = type ? getBusinessByType(userId, type) : getBusiness(userId);
      if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Business not found. Use `/business list` to see yours.")], ephemeral:true });

      const bizType = BIZ_TYPES[biz.type];
      if (biz.level >= bizType.maxLevel) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('Already at **MAX LEVEL**!')], ephemeral:true });

      const cost = bizType.upgradeCost * biz.level;
      const user = getOrCreateUser(userId);
      if (user.wallet < cost) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Need **$${cost.toLocaleString()}** to upgrade. You have **$${user.wallet.toLocaleString()}**.`)], ephemeral:true });

      const oldIncome = calcIncome(biz);
      user.wallet -= cost; biz.level++;
      saveUser(userId, user); await saveBusiness(userId, biz);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`⭐ ${biz.name} — Level ${biz.level}!`)
        .setDescription(`Upgraded **${bizType.name}** to **Level ${biz.level}**!`)
        .addFields(
          { name:'📈 Before', value:`$${oldIncome.toLocaleString()}/min`, inline:true },
          { name:'📈 Now',    value:`$${calcIncome(biz).toLocaleString()}/min`, inline:true },
          { name:'💵 Wallet', value:`$${user.wallet.toLocaleString()}`, inline:true },
        )
      ]});
    }

    // ── CLOSE ─────────────────────────────────────────────────
    if (sub === 'close') {
      const type = interaction.options.getString('type');
      const biz  = getBusinessByType(userId, type);
      if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't own a **${BIZ_TYPES[type]?.name||type}**.`)], ephemeral:true });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('biz_close_confirm').setLabel('Yes, close it').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('biz_close_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('⚠️ Close Business?')
        .setDescription(`Permanently close **${biz.name}**? No refund. All employees let go.`)
      ], components:[row], ephemeral:true });

      const msg = await interaction.fetchReply();
      const col2 = msg.createMessageComponentCollector({ time:30_000 });
      col2.on('collect', async btn => {
        col2.stop();
        if (btn.customId === 'biz_close_cancel') return btn.update({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('Cancelled.')], components:[] });
        await deleteBusiness(userId, type);
        await btn.update({ embeds:[new EmbedBuilder().setColor(0x888888).setTitle('🏢 Business Closed').setDescription(`**${biz.name}** has been permanently closed.`)], components:[] });
      });
    }
  },
};
