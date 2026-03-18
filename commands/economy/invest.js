const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getConfig } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
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
  try {
    if (!fs.existsSync(PRICES_FILE)) return initPrices();
    return JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8'));
  } catch { return initPrices(); }
}

function initPrices() {
  const prices = {};
  COINS.forEach(c => { prices[c.id] = 50 + Math.random() * 450; });
  fs.writeFileSync(PRICES_FILE, JSON.stringify(prices, null, 2));
  return prices;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invest')
    .setDescription('Invest in a memecoin.')
    .addStringOption(o => o.setName('coin').setDescription('Coin to invest in').setRequired(true)
      .addChoices(...COINS.map(c => ({ name: `${c.emoji} ${c.name} (${c.id})`, value: c.id }))))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to invest from wallet').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const coinId = interaction.options.getString('coin');
    const amount = interaction.options.getInteger('amount');
    const coin   = COINS.find(c => c.id === coinId);
    const prices = getPrices();
    const price  = prices[coinId] || 100;

    const user = getOrCreateUser(interaction.user.id);
    if (amount > user.wallet) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff3b3b).setTitle('❌ Insufficient Funds').setDescription(`You only have **$${user.wallet.toLocaleString()}** in your wallet.`)], ephemeral: true });

    if (!user.stocks) user.stocks = {};
    const shares = amount / price;
    user.wallet -= amount;
    if (!user.stocks[coinId]) user.stocks[coinId] = { shares: 0, invested: 0 };
    user.stocks[coinId].shares   += shares;
    user.stocks[coinId].invested += amount;
    saveUser(interaction.user.id, user);

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`${coin.emoji} Invested in ${coin.name}`)
      .setDescription(`You invested **$${amount.toLocaleString()}** in **${coin.name}** at **$${price.toFixed(2)}** per coin.`)
      .addFields(
        { name: '📊 Shares Bought',  value: shares.toFixed(6),               inline: true },
        { name: '💵 Wallet Left',    value: `$${user.wallet.toLocaleString()}`, inline: true },
      )
      .setFooter({ text: 'Use /cashout to sell your shares' })
    ]});
  },
};
