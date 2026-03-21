const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const PRICES_FILE   = path.join(__dirname, '../../data/stockPrices.json');
const HISTORY_FILE  = path.join(__dirname, '../../data/stockHistory.json');

const COINS = [
  { id:'DOGE2',  name:'Doge 2.0',       emoji:'🐕', color:0xf5c518, desc:'Such wow. Much gains. Very moon.' },
  { id:'PEPE',   name:'PepeCoin',        emoji:'🐸', color:0x2ecc71, desc:"Feels good man. Until it doesn't." },
  { id:'RUGPUL', name:'RugPull Finance', emoji:'🪤', color:0xff3b3b, desc:'This is fine. Everything is fine.' },
  { id:'MOON',   name:'MoonShot',        emoji:'🚀', color:0x00d2ff, desc:"To the moon. Or the floor." },
  { id:'BODEN',  name:'BodenBucks',      emoji:'🦅', color:0x9b59b6, desc:'Not financial advice. Ever.' },
  { id:'CHAD',   name:'ChadToken',       emoji:'💪', color:0xff6b35, desc:'Alpha moves only.' },
];

function getPrices() {
  try { return JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8')); } catch { return {}; }
}

function getHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return {}; }
}

function buildBar(value, max, width = 12) {
  const filled = Math.round((value / max) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

function buildCoinEmbed(coin, prices, history) {
  const price   = prices[coin.id] || 100;
  const hist    = history[coin.id] || [];
  const prev    = hist.length >= 2 ? hist[hist.length - 2] : price;
  const change  = ((price - prev) / prev) * 100;
  const up      = change >= 0;

  // 24h stats from history
  const day     = hist.slice(-144); // ~24h at 10s intervals
  const dayHigh = day.length ? Math.max(...day) : price;
  const dayLow  = day.length ? Math.min(...day) : price;
  const dayOpen = day.length ? day[0] : price;
  const dayChg  = ((price - dayOpen) / dayOpen) * 100;

  // ASCII sparkline (20 chars wide)
  const spark   = hist.slice(-20);
  const sparkMin = Math.min(...spark), sparkMax = Math.max(...spark);
  const sparkRange = sparkMax - sparkMin || 1;
  const bars = ['▁','▂','▃','▄','▅','▆','▇','█'];
  const sparkline = spark.map(v => bars[Math.floor(((v - sparkMin) / sparkRange) * 7)]).join('');

  // Hype meter
  const rawHype = hist.length > 1
    ? Math.min(1, Math.max(0, (hist.slice(-10).reduce((a,b,i,arr) => a + (i>0?b-arr[i-1]:0), 0) / (hist[hist.length-1] || 1)) + 0.5))
    : 0.5;
  const hype    = Math.round(rawHype * 100);
  const hypeBar = buildBar(hype, 100, 15);
  const hypeLabel = hype > 65 ? '🔥 HOT' : hype < 35 ? '🧊 COLD' : '😐 NEUTRAL';

  const fmtP = (p) => {
    if (p >= 1e12) return '$' + (p/1e12).toFixed(2) + 'T';
    if (p >= 1e9)  return '$' + (p/1e9).toFixed(2)  + 'B';
    if (p >= 1e6)  return '$' + (p/1e6).toFixed(2)  + 'M';
    if (p >= 1000) return '$' + Math.round(p).toLocaleString();
    if (p >= 1)    return '$' + p.toFixed(2);
    return '$' + p.toFixed(4);
  };
  const priceStr = fmtP(price);

  return new EmbedBuilder()
    .setColor(coin.color)
    .setTitle(`${coin.emoji} ${coin.name} (${coin.id})`)
    .setDescription(
      `*${coin.desc}*\n\n` +
      `\`\`\`\n${sparkline}\n\`\`\``
    )
    .addFields(
      { name: '💰 Price',      value: priceStr,                                           inline: true },
      { name: up ? '📈 Change' : '📉 Change', value: `${up?'+':''}${change.toFixed(2)}%`,      inline: true },
      { name: '📊 24h Change', value: `${dayChg >= 0 ? '+' : ''}${dayChg.toFixed(2)}%`,        inline: true },
      { name: '🔺 24h High',   value: `$${dayHigh < 10 ? dayHigh.toFixed(4) : dayHigh.toFixed(2)}`, inline: true },
      { name: '🔻 24h Low',    value: `$${dayLow  < 10 ? dayLow.toFixed(4)  : dayLow.toFixed(2)}`,  inline: true },
      { name: '📉 24h Open',   value: `$${dayOpen < 10 ? dayOpen.toFixed(4) : dayOpen.toFixed(2)}`,  inline: true },
      { name: `🌡️ Hype [${hypeBar}]`, value: `${hype}% — ${hypeLabel}`, inline: false },
    )
    .setFooter({ text: `Prices update every 10 seconds · Use /invest to buy · /portfolio to view holdings` })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('market')
    .setDescription('View memecoin charts and price movements.')
    .addStringOption(o => o
      .setName('coin')
      .setDescription('View a specific coin (or leave blank to see all)')
      .setRequired(false)
      .addChoices(...COINS.map(c => ({ name: `${c.emoji} ${c.name}`, value: c.id })))
    ),

  async execute(interaction) {
    const coinId = interaction.options.getString('coin');
    const prices = getPrices();
    const history = getHistory();

    if (coinId) {
      const coin = COINS.find(c => c.id === coinId);
      if (!coin) return interaction.reply({ content: 'Coin not found.', ephemeral: true });
      return interaction.reply({ embeds: [buildCoinEmbed(coin, prices, history)] });
    }

    // Overview — all coins
    let page = 0;
    const buildOverview = () => {
      const coin = COINS[page];
      return buildCoinEmbed(coin, prices, history)
        .setTitle(`${coin.emoji} ${coin.name} (${coin.id}) — ${page + 1}/${COINS.length}`);
    };

    const buildRow = (p) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mkt_prev_${p}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
      new ButtonBuilder().setCustomId(`mkt_all_${p}`).setLabel(`${p + 1} / ${COINS.length}`).setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId(`mkt_next_${p}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= COINS.length - 1),
    );

    await interaction.reply({ embeds: [buildOverview()], components: [buildRow(page)] });

    const msg       = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 180_000 });

    collector.on('collect', async btn => {
      if (btn.user.id !== interaction.user.id) return btn.reply({ content: "Use /market yourself.", ephemeral: true });
      if (btn.customId.startsWith('mkt_prev')) page = Math.max(0, page - 1);
      if (btn.customId.startsWith('mkt_next')) page = Math.min(COINS.length - 1, page + 1);
      const freshPrices  = getPrices();
      const freshHistory = getHistory();
      await btn.update({ embeds: [buildCoinEmbed(COINS[page], freshPrices, freshHistory).setTitle(`${COINS[page].emoji} ${COINS[page].name} (${COINS[page].id}) — ${page+1}/${COINS.length}`)], components: [buildRow(page)] });
    });

    collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
  },
};
