// ============================================================
// commands/economy/market.js
// Shows all coins — built-in + custom Crypto Lab coins
// Prices and history loaded from MongoDB
// ============================================================

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { col } = require('../../utils/mongo');
const { coinAutocomplete, DEFAULT_COINS, fmtP } = require('../../utils/coinAutocomplete');

const DEFAULT_COIN_META = {
  DOGE2:  { name:'Doge 2.0',       emoji:'🐕', color:0xf5c518, desc:'Such wow. Much gains. Very moon.' },
  PEPE:   { name:'PepeCoin',        emoji:'🐸', color:0x2ecc71, desc:"Feels good man. Until it doesn't." },
  RUGPUL: { name:'RugPull Finance', emoji:'🪤', color:0xff3b3b, desc:'This is fine. Everything is fine.' },
  MOON:   { name:'MoonShot',        emoji:'🚀', color:0x00d2ff, desc:"To the moon. Or the floor." },
  BODEN:  { name:'BodenBucks',      emoji:'🦅', color:0x9b59b6, desc:'Not financial advice. Ever.' },
  CHAD:   { name:'ChadToken',       emoji:'💪', color:0xff6b35, desc:'Alpha moves only.' },
};

function buildBar(value, max, width = 12) {
  const filled = Math.round((value / max) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

function buildCoinEmbed(coin, prices, histories, total, page) {
  const price  = prices[coin.id] || 0.01;
  const hist   = (histories[coin.id] || []).map(h => typeof h === 'object' ? h.p : h);
  const prev   = hist.length >= 2 ? hist[hist.length - 2] : price;
  const change = ((price - prev) / prev) * 100;
  const up     = change >= 0;

  const day    = hist.slice(-144);
  const dayHigh = day.length ? Math.max(...day) : price;
  const dayLow  = day.length ? Math.min(...day) : price;
  const dayOpen = day.length ? day[0] : price;
  const dayChg  = ((price - dayOpen) / dayOpen) * 100;

  const spark    = hist.slice(-20);
  const sparkMin = Math.min(...spark), sparkMax = Math.max(...spark);
  const sparkRange = sparkMax - sparkMin || 1;
  const bars     = ['▁','▂','▃','▄','▅','▆','▇','█'];
  const sparkline = spark.length > 1
    ? spark.map(v => bars[Math.floor(((v - sparkMin) / sparkRange) * 7)]).join('')
    : '——————';

  const rawHype = hist.length > 1
    ? Math.min(1, Math.max(0, (hist.slice(-10).reduce((a,b,i,arr) => a+(i>0?b-arr[i-1]:0),0) / (hist[hist.length-1]||1)) + 0.5))
    : 0.5;
  const hype     = Math.round(rawHype * 100);
  const hypeBar  = buildBar(hype, 100, 15);
  const hypeLabel= hype > 65 ? '🔥 HOT' : hype < 35 ? '🧊 COLD' : '😐 NEUTRAL';

  const isCustom = !!coin.custom;
  const pageInfo = total > 1 ? ` — ${page+1}/${total}` : '';

  return new EmbedBuilder()
    .setColor(coin.color || 0x5865f2)
    .setTitle(`${coin.emoji} ${coin.name} (${coin.id})${pageInfo}${isCustom ? ' 💻' : ''}`)
    .setDescription(
      `*${coin.desc || (isCustom ? 'Custom Crypto Lab coin.' : '')}*\n\n` +
      `\`\`\`\n${sparkline}\n\`\`\``
    )
    .addFields(
      { name:'💰 Price',      value:fmtP(price),                                              inline:true },
      { name:up?'📈 Change':'📉 Change', value:`${up?'+':''}${change.toFixed(2)}%`,           inline:true },
      { name:'📊 24h Change', value:`${dayChg>=0?'+':''}${dayChg.toFixed(2)}%`,               inline:true },
      { name:'🔺 24h High',   value:fmtP(dayHigh),                                            inline:true },
      { name:'🔻 24h Low',    value:fmtP(dayLow),                                             inline:true },
      { name:'📉 24h Open',   value:fmtP(dayOpen),                                            inline:true },
      { name:`🌡️ Hype [${hypeBar}]`, value:`${hype}% — ${hypeLabel}`,                        inline:false },
      ...(isCustom && coin.ownerName ? [{ name:'👤 Created by', value:coin.ownerName, inline:true }] : []),
    )
    .setFooter({ text:`Use /invest to buy · /cashout to sell · /portfolio for holdings` })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('market')
    .setDescription('View live memecoin prices and charts — including custom Crypto Lab coins.')
    .addStringOption(o => o
      .setName('coin')
      .setDescription('View a specific coin (leave blank to browse all)')
      .setRequired(false)
      .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    return coinAutocomplete(interaction, 'coin');
  },

  async execute(interaction) {
    await interaction.deferReply();

    // Load prices and history from MongoDB
    const [pdoc, hdoc, customDocs] = await Promise.all([
      col('stockPrices').then(c => c.findOne({ _id:'prices' })).catch(()=>null),
      col('stockHistory').then(c => c.find({}).toArray()).catch(()=>[]),
      col('customCoins').then(c => c.find({}).toArray()).catch(()=>[]),
    ]);

    const prices    = pdoc ? { ...pdoc, _id:undefined } : {};
    const histories = {};
    for (const h of (hdoc||[])) {
      if (h._id && h.history) histories[h._id] = h.history;
    }

    // Build full coin list: built-ins + custom
    const allCoins = [
      ...DEFAULT_COINS.map(c => ({
        ...c,
        color: DEFAULT_COIN_META[c.id]?.color || 0x5865f2,
        desc:  DEFAULT_COIN_META[c.id]?.desc  || '',
        custom: false,
      })),
      ...customDocs.map(c => ({
        id:     c._id,
        name:   c.name,
        emoji:  c.emoji  || '🪙',
        color:  c.color  || 0x5865f2,
        desc:   c.description || c.desc || 'Custom coin.',
        custom: true,
        ownerName: c.ownerName || null,
      })),
    ];

    const coinId = interaction.options.getString('coin');

    if (coinId) {
      const coin = allCoins.find(c => c.id === coinId);
      if (!coin) return interaction.editReply({ content:`Coin **${coinId}** not found. Use \`/market\` to browse all coins.` });
      return interaction.editReply({ embeds:[buildCoinEmbed(coin, prices, histories, 1, 0)] });
    }

    // Paginated overview
    let page = 0;
    const total = allCoins.length;

    const buildRow = (p) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mkt_prev_${p}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p===0),
      new ButtonBuilder().setCustomId(`mkt_page_${p}`).setLabel(`${p+1} / ${total}`).setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId(`mkt_next_${p}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p>=total-1),
    );

    await interaction.editReply({
      embeds: [buildCoinEmbed(allCoins[page], prices, histories, total, page)],
      components: [buildRow(page)],
    });

    const msg       = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time:180_000 });

    collector.on('collect', async btn => {
      if (btn.user.id !== interaction.user.id) return btn.reply({ content:'Use /market yourself.', ephemeral:true });
      if (btn.customId.startsWith('mkt_prev')) page = Math.max(0, page-1);
      if (btn.customId.startsWith('mkt_next')) page = Math.min(total-1, page+1);

      // Refresh prices
      const fp = await col('stockPrices').then(c=>c.findOne({_id:'prices'})).catch(()=>null);
      const freshPrices = fp ? { ...fp, _id:undefined } : prices;
      await btn.update({
        embeds: [buildCoinEmbed(allCoins[page], freshPrices, histories, total, page)],
        components: [buildRow(page)],
      });
    });

    collector.on('end', () => interaction.editReply({ components:[] }).catch(()=>{}));
  },
};
