const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const { col } = require('../../utils/mongo');
const { coinAutocomplete } = require('../../utils/coinAutocomplete');

const DEFAULT_COINS = [
  { id:'DOGE2',  name:'Doge 2.0',       emoji:'🐕' },
  { id:'PEPE',   name:'PepeCoin',        emoji:'🐸' },
  { id:'RUGPUL', name:'RugPull Finance', emoji:'🪤' },
  { id:'MOON',   name:'MoonShot',        emoji:'🚀' },
  { id:'BODEN',  name:'BodenBucks',      emoji:'🦅' },
  { id:'CHAD',   name:'ChadToken',       emoji:'💪' },
];

const fmtP = (p) => {
  if (p >= 1e12) return '$' + (p/1e12).toFixed(2) + 'T';
  if (p >= 1e9)  return '$' + (p/1e9).toFixed(2)  + 'B';
  if (p >= 1e6)  return '$' + (p/1e6).toFixed(2)  + 'M';
  if (p >= 1000) return '$' + Math.round(p).toLocaleString();
  if (p >= 1)    return '$' + p.toFixed(2);
  return '$' + p.toFixed(4);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invest')
    .setDescription('Invest in a memecoin.')
    .addStringOption(o => o.setName('coin').setDescription('Coin ticker (e.g. DOGE2, MOON, or a custom coin ID)').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('amount').setDescription('Amount to invest — type a number or "all" to invest your full wallet').setRequired(true)),

  async autocomplete(interaction) { return coinAutocomplete(interaction, 'coin'); },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const coinId = interaction.options.getString('coin').toUpperCase();
    const amountRaw = interaction.options.getString('amount').toLowerCase().trim();
    const user0 = getOrCreateUser(userId);
    const amount = amountRaw === 'all' ? user0.wallet : parseInt(amountRaw.replace(/,/g,''));
    if (isNaN(amount) || amount < 1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setDescription('Enter a valid amount or type `all`.')], ephemeral:true });

    // Get current price from MongoDB
    const pc   = await col('stockPrices');
    const pdoc = await pc.findOne({ _id: 'prices' }).catch(()=>null);
    const prices = pdoc ? { ...pdoc } : {};
    delete prices._id;

    if (!prices[coinId]) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setDescription(`Coin **${coinId}** not found. Use autocomplete to pick a valid coin.`)], ephemeral:true });
    }

    const price = prices[coinId];

    // Find coin info
    const cc = await col('customCoins');
    const customCoin = await cc.findOne({ _id: coinId }).catch(()=>null);
    const defaultCoin = DEFAULT_COINS.find(c => c.id === coinId);
    const coin = customCoin
      ? { id: coinId, name: customCoin.name, emoji: customCoin.emoji || '🪙' }
      : defaultCoin || { id: coinId, name: coinId, emoji: '🪙' };

    const user = getOrCreateUser(interaction.user.id);
    if (amount > user.wallet) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setDescription(`You only have **$${user.wallet.toLocaleString()}** in your wallet.`)], ephemeral:true });
    }

    const shares = amount / price;
    user.wallet -= amount;
    if (!user.stocks) user.stocks = {};
    if (!user.stocks[coinId]) user.stocks[coinId] = { shares: 0, invested: 0 };
    user.stocks[coinId].shares   += shares;
    user.stocks[coinId].invested += amount;
    saveUser(interaction.user.id, user);

    // ── CRYPTO LAB REVENUE ──────────────────────────────────────
    // If this is a custom coin, 10% of the investment goes to the
    // Crypto Lab owner's business revenue (ready to collect)
    if (customCoin?.ownerId) {
      try {
        const { getBusiness, saveBusiness } = require('../../utils/bizDb');
        const ownerBiz = getBusiness(customCoin.ownerId);
        if (ownerBiz && ownerBiz.type === 'cryptolab') {
          const cut = Math.floor(amount * 0.10);
          ownerBiz.revenue    = (ownerBiz.revenue || 0) + cut;
          ownerBiz.totalEarned = (ownerBiz.totalEarned || 0) + cut;
          await saveBusiness(customCoin.ownerId, ownerBiz);
        }
      } catch(e) { console.error('crypto lab revenue error:', e.message); }
    }

    await interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`${coin.emoji} Invested in ${coin.name}${customCoin ? ' 💻' : ''}`)
      .setDescription(`You invested **$${amount.toLocaleString()}** in **${coin.name}** at **${fmtP(price)}** per coin.${customCoin ? `\n\n*This is a player-created coin. Invest at your own risk.*` : ''}`)
      .addFields(
        { name:'📊 Shares Bought', value:shares.toFixed(6),                inline:true },
        { name:'💵 Wallet Left',   value:`$${user.wallet.toLocaleString()}`, inline:true },
      )
      .setFooter({ text:'Use /cashout to sell · /portfolio to view investments' })
    ]});
  },
};
