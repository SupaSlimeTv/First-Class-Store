const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
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
    .setName('cashout')
    .setDescription('Cash out your investment in a memecoin.')
    .addStringOption(o => o.setName('coin').setDescription('Coin to cash out').setRequired(true)
      .addChoices(...COINS.map(c => ({ name: `${c.emoji} ${c.name} (${c.id})`, value: c.id })))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const coinId = interaction.options.getString('coin');
    const coin   = COINS.find(c => c.id === coinId);
    const user   = getOrCreateUser(interaction.user.id);

    if (!user.stocks?.[coinId] || user.stocks[coinId].shares <= 0) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff3b3b).setTitle('❌ No Investment').setDescription(`You don't have any **${coin.name}** shares to cash out.`)], ephemeral: true });
    }

    const prices   = getPrices();
    const price    = prices[coinId] || 100;
    const shares   = user.stocks[coinId].shares;
    const invested = user.stocks[coinId].invested;
    const value    = shares * price;
    const profit   = value - invested;
    const pct      = ((profit / invested) * 100).toFixed(2);

    user.wallet += Math.floor(value);
    delete user.stocks[coinId];
    saveUser(interaction.user.id, user);

    const won = profit >= 0;
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(won ? 0x2ecc71 : 0xff3b3b)
      .setTitle(`${coin.emoji} Cashed Out ${coin.name}`)
      .setDescription(`You sold **${shares.toFixed(6)} shares** at **$${price.toFixed(2)}** each.`)
      .addFields(
        { name: '💰 Received',   value: `$${Math.floor(value).toLocaleString()}`, inline: true },
        { name: won ? '📈 Profit' : '📉 Loss', value: `${won?'+':''} $${Math.floor(Math.abs(profit)).toLocaleString()} (${won?'+':''}${pct}%)`, inline: true },
        { name: '💵 New Wallet', value: `$${user.wallet.toLocaleString()}`, inline: true },
      )
    ]});
  },
};
