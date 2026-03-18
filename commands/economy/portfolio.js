const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const fs   = require('fs');
const path = require('path');

const COINS = [
  { id:'DOGE2',  name:'Doge 2.0',       emoji:'🐕' },
  { id:'PEPE',   name:'PepeCoin',        emoji:'🐸' },
  { id:'RUGPUL', name:'RugPull Finance', emoji:'🪤' },
  { id:'MOON',   name:'MoonShot',        emoji:'🚀' },
  { id:'BODEN',  name:'BodenBucks',      emoji:'🦅' },
  { id:'CHAD',   name:'ChadToken',       emoji:'💪' },
];

const PRICES_FILE = path.join(__dirname, '../../data/stockPrices.json');
function getPrices() {
  try { return JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8')); }
  catch { return {}; }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('portfolio')
    .setDescription('View your current coin investments.'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const user   = getOrCreateUser(interaction.user.id);
    const stocks = user.stocks || {};
    const prices = getPrices();

    const holdings = Object.entries(stocks).filter(([,s]) => s.shares > 0);
    if (!holdings.length) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📊 Your Portfolio').setDescription("You don't have any active investments.\nUse `/invest` to buy into a coin!")], ephemeral: true });
    }

    let totalInvested = 0, totalValue = 0;
    const lines = holdings.map(([coinId, s]) => {
      const coin    = COINS.find(c => c.id === coinId) || { emoji:'🪙', name: coinId };
      const price   = prices[coinId] || 100;
      const value   = s.shares * price;
      const profit  = value - s.invested;
      const pct     = ((profit / s.invested)*100).toFixed(1);
      const arrow   = profit >= 0 ? '📈' : '📉';
      totalInvested += s.invested;
      totalValue    += value;
      return `${coin.emoji} **${coin.name}** — ${s.shares.toFixed(4)} shares\n  Current: **$${Math.floor(value).toLocaleString()}** · Invested: $${Math.floor(s.invested).toLocaleString()} · ${arrow} ${profit>=0?'+':''}$${Math.floor(Math.abs(profit)).toLocaleString()} (${profit>=0?'+':''}${pct}%)`;
    });

    const totalProfit = totalValue - totalInvested;
    const totalPct    = totalInvested > 0 ? ((totalProfit/totalInvested)*100).toFixed(1) : '0.0';

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(totalProfit >= 0 ? 0x2ecc71 : 0xff3b3b)
      .setTitle('📊 Your Portfolio')
      .setDescription(lines.join('\n\n'))
      .addFields(
        { name: '💰 Total Invested', value: `$${Math.floor(totalInvested).toLocaleString()}`, inline: true },
        { name: '📈 Current Value',  value: `$${Math.floor(totalValue).toLocaleString()}`,    inline: true },
        { name: totalProfit>=0?'✅ Total Profit':'❌ Total Loss', value: `${totalProfit>=0?'+':''}$${Math.floor(Math.abs(totalProfit)).toLocaleString()} (${totalProfit>=0?'+':''}${totalPct}%)`, inline: true },
      )
      .setFooter({ text: 'Prices update every 10 seconds • Use /cashout to sell' })
    ]});
  },
};
