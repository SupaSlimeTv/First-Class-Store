const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const { col } = require('../../utils/mongo');

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
    .setName('cashout')
    .setDescription('Cash out your investment in a memecoin.')
    .addStringOption(o => o.setName('coin').setDescription('Coin to cash out').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const user = getOrCreateUser(interaction.user.id);
    const holdings = user.stocks || {};
    if (!Object.keys(holdings).length) {
      return interaction.respond([{ name:'No active investments', value:'DOGE2' }]);
    }

    // Get prices
    const pc   = await col('stockPrices');
    const pdoc = await pc.findOne({ _id:'prices' }).catch(()=>null);
    const prices = pdoc ? { ...pdoc } : {};
    delete prices._id;

    // Get custom coin names
    const cc = await col('customCoins');
    const custom = await cc.find({}).toArray().catch(()=>[]);
    const customMap = Object.fromEntries(custom.map(c => [c._id, c]));

    const opts = Object.entries(holdings)
      .filter(([, h]) => h.shares > 0)
      .map(([id]) => {
        const p   = prices[id];
        const def = DEFAULT_COINS.find(c => c.id === id);
        const cus = customMap[id];
        const name  = cus ? cus.name  : def ? def.name  : id;
        const emoji = cus ? cus.emoji : def ? def.emoji : '🪙';
        return { name:`${emoji} ${name} (${id}) — ${p ? fmtP(p) : '?'}`, value: id };
      });

    await interaction.respond(opts.slice(0, 25));
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const coinId = interaction.options.getString('coin').toUpperCase();
    const user   = getOrCreateUser(interaction.user.id);

    if (!user.stocks?.[coinId] || user.stocks[coinId].shares <= 0) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setDescription(`You don't have any **${coinId}** shares to cash out.`)], ephemeral:true });
    }

    // Get current price
    const pc   = await col('stockPrices');
    const pdoc = await pc.findOne({ _id:'prices' }).catch(()=>null);
    const prices = pdoc ? { ...pdoc } : {};
    delete prices._id;
    const price = prices[coinId] || 0.001;

    // Coin info
    const cc = await col('customCoins');
    const customCoin = await cc.findOne({ _id: coinId }).catch(()=>null);
    const defCoin    = DEFAULT_COINS.find(c => c.id === coinId);
    const coinName   = customCoin?.name  || defCoin?.name  || coinId;
    const coinEmoji  = customCoin?.emoji || defCoin?.emoji || '🪙';

    const shares   = user.stocks[coinId].shares;
    const invested = user.stocks[coinId].invested;
    const value    = shares * price;
    const profit   = value - invested;
    const pct      = invested > 0 ? ((profit / invested) * 100).toFixed(2) : '0.00';

    user.wallet += Math.floor(value);
    delete user.stocks[coinId];
    saveUser(interaction.user.id, user);

    const won = profit >= 0;
    await interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(won ? 0x2ecc71 : 0xff3b3b)
      .setTitle(`${coinEmoji} Cashed Out ${coinName}`)
      .setDescription(`You sold **${shares.toFixed(6)} shares** at **${fmtP(price)}** each.`)
      .addFields(
        { name:'💰 Received',                              value:`$${Math.floor(value).toLocaleString()}`,          inline:true },
        { name: won ? '📈 Profit' : '📉 Loss',            value:`${won?'+':''} $${Math.floor(Math.abs(profit)).toLocaleString()} (${won?'+':''}${pct}%)`, inline:true },
        { name:'💵 New Wallet',                            value:`$${user.wallet.toLocaleString()}`,                inline:true },
      )
    ]});
  },
};
