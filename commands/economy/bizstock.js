// ============================================================
// commands/economy/bizstock.js — /bizstock
// Trade shares in user-created businesses. Prices update every
// 5 minutes based on business fundamentals + random noise.
// ============================================================
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getAllBusinesses, BIZ_TYPES } = require('../../utils/bizDb');
const {
  getBizStockPrice, getAllBizStockPrices,
  calcFundamentalPrice, initBizStock,
} = require('../../utils/bizStockDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();
const fmtPrice = p => p >= 1000 ? '$' + Math.round(p).toLocaleString()
                    : p >= 1    ? '$' + p.toFixed(2)
                    : '$' + p.toFixed(4);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bizstock')
    .setDescription('Trade shares in user-created businesses')
    .addSubcommand(s => s.setName('list')
      .setDescription('Browse all tradeable business stocks'))
    .addSubcommand(s => s.setName('buy')
      .setDescription('Buy shares in a business')
      .addStringOption(o => o.setName('business').setDescription('Search by business name').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Dollar amount to invest').setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName('sell')
      .setDescription('Sell shares you own in a business')
      .addStringOption(o => o.setName('business').setDescription('Search by business name').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('percent').setDescription('Percent of your shares to sell (1–100)').setRequired(true).setMinValue(1).setMaxValue(100)))
    .addSubcommand(s => s.setName('portfolio')
      .setDescription('View your business stock holdings')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'business') return;
    const sub = interaction.options.getSubcommand(false);
    const q   = focused.value.toLowerCase();

    let pool;
    if (sub === 'sell') {
      const user = getOrCreateUser(interaction.user.id);
      const owned = Object.keys(user.bizStocks || {});
      const all   = getAllBusinesses();
      pool = owned.map(id => all[id]).filter(Boolean);
    } else {
      pool = Object.values(getAllBusinesses());
    }

    const matches = pool
      .filter(b => b.name.toLowerCase().includes(q) || (BIZ_TYPES[b.type]?.name||'').toLowerCase().includes(q))
      .slice(0, 25)
      .map(b => ({
        name: `${BIZ_TYPES[b.type]?.emoji||'🏢'} ${b.name} (${BIZ_TYPES[b.type]?.name||b.type})`.slice(0, 100),
        value: b.id,
      }));
    return interaction.respond(matches).catch(() => null);
  },

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    if (noAccount(userId)) return interaction.reply({ content:'No account. Use /start.', ephemeral:true });

    // ── LIST ─────────────────────────────────────────────────
    if (sub === 'list') {
      const all     = getAllBusinesses();
      const prices  = getAllBizStockPrices();
      const entries = Object.values(all)
        .map(biz => ({ biz, price: prices[biz.id] || calcFundamentalPrice(biz) }))
        .sort((a, b) => b.price - a.price)
        .slice(0, 20);

      if (!entries.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.INFO)
        .setDescription('No businesses exist yet. Use `/business start` to open one.')
      ], ephemeral:true });

      const lines = entries.map(({ biz, price }) => {
        const fund = calcFundamentalPrice(biz);
        const pct  = ((price / fund - 1) * 100).toFixed(1);
        const sign = price >= fund ? '📈' : '📉';
        return `${BIZ_TYPES[biz.type]?.emoji||'🏢'} **${biz.name}** · Lv${biz.level||1} ${BIZ_TYPES[biz.type]?.name||biz.type} — **${fmtPrice(price)}** ${sign} ${pct}% vs fair value`;
      }).join('\n');

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x00d2ff)
        .setTitle('📊 Business Stock Exchange')
        .setDescription(lines)
        .setFooter({ text: '/bizstock buy <name> <$amount> to invest • prices update every 5 min' })
      ]});
    }

    const user = getOrCreateUser(userId);

    // ── BUY ──────────────────────────────────────────────────
    if (sub === 'buy') {
      const bizId  = interaction.options.getString('business');
      const amount = interaction.options.getInteger('amount');
      const all    = getAllBusinesses();
      const biz    = all[bizId];
      if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Business not found.')], ephemeral:true });
      if (user.wallet < amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You only have **${fmtMoney(user.wallet)}** in your wallet.`)
      ], ephemeral:true });

      const price  = getBizStockPrice(bizId) || await initBizStock(bizId, biz);
      const shares = amount / price;

      user.wallet -= amount;
      if (!user.bizStocks) user.bizStocks = {};
      if (!user.bizStocks[bizId]) user.bizStocks[bizId] = { shares:0, invested:0, bizName:biz.name };
      user.bizStocks[bizId].shares   += shares;
      user.bizStocks[bizId].invested += amount;
      user.bizStocks[bizId].bizName   = biz.name;
      await saveUser(userId, user);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`${BIZ_TYPES[biz.type]?.emoji||'🏢'} Shares Purchased`)
        .setDescription(`Bought **${shares.toFixed(4)} shares** in **${biz.name}** at ${fmtPrice(price)}/share.\n\nInvested: **${fmtMoney(amount)}** · Total shares held: **${user.bizStocks[bizId].shares.toFixed(4)}**`)
      ], ephemeral:true });
    }

    // ── SELL ─────────────────────────────────────────────────
    if (sub === 'sell') {
      const bizId   = interaction.options.getString('business');
      const percent = interaction.options.getInteger('percent');
      const holding = user.bizStocks?.[bizId];
      if (!holding || holding.shares <= 0.0001) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription("You don't own shares in that business.")
      ], ephemeral:true });

      const all          = getAllBusinesses();
      const biz          = all[bizId];
      const price        = getBizStockPrice(bizId) || calcFundamentalPrice(biz || { level:1, totalEarned:0, type:'restaurant' });
      const sharesToSell = holding.shares * (percent / 100);
      const proceeds     = sharesToSell * price;
      const costBasis    = holding.invested * (percent / 100);
      const profit       = proceeds - costBasis;

      user.wallet += proceeds;
      user.bizStocks[bizId].shares   -= sharesToSell;
      user.bizStocks[bizId].invested -= costBasis;
      if (user.bizStocks[bizId].shares < 0.0001) delete user.bizStocks[bizId];
      await saveUser(userId, user);

      const profitStr = `${profit >= 0 ? '+' : ''}${fmtMoney(profit)} ${profit >= 0 ? '📈' : '📉'}`;
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(profit >= 0 ? 0x2ecc71 : 0xff3b3b)
        .setTitle(`${BIZ_TYPES[biz?.type]?.emoji||'🏢'} Shares Sold`)
        .setDescription(`Sold **${percent}%** of your **${holding.bizName}** shares for **${fmtMoney(proceeds)}**.\n\nP&L: **${profitStr}**`)
      ], ephemeral:true });
    }

    // ── PORTFOLIO ────────────────────────────────────────────
    if (sub === 'portfolio') {
      const holdings = Object.entries(user.bizStocks || {}).filter(([, h]) => h.shares > 0.0001);
      if (!holdings.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.INFO)
        .setDescription("You don't own any business shares yet. Use `/bizstock buy`.")
      ], ephemeral:true });

      const all = getAllBusinesses();
      let totalValue = 0, totalInvested = 0;
      const lines = holdings.map(([bizId, h]) => {
        const biz    = all[bizId];
        const price  = getBizStockPrice(bizId) || 10;
        const value  = h.shares * price;
        const profit = value - h.invested;
        totalValue    += value;
        totalInvested += h.invested;
        return `${BIZ_TYPES[biz?.type]?.emoji||'🏢'} **${h.bizName}** — ${fmtMoney(value)} (${profit>=0?'+':''}${fmtMoney(profit)})`;
      }).join('\n');

      const totalProfit = totalValue - totalInvested;
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x00d2ff)
        .setTitle('📊 Your Business Stock Portfolio')
        .setDescription(lines)
        .addFields(
          { name:'Total Value',   value:fmtMoney(totalValue),    inline:true },
          { name:'Invested',      value:fmtMoney(totalInvested), inline:true },
          { name:'P&L',           value:`${totalProfit>=0?'+':''}${fmtMoney(totalProfit)}`, inline:true },
        )
      ], ephemeral:true });
    }
  },
};
