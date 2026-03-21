const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBusiness } = require('../../utils/bizDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const { col } = require('../../utils/mongo');

const TENDENCY_PRESETS = {
  moon:     { drift:0.008,  crashChance:0.02, moonChance:0.12, crashMag:0.30, moonMag:4.00 },
  rug:      { drift:-0.010, crashChance:0.12, moonChance:0.02, crashMag:0.80, moonMag:1.50 },
  balanced: { drift:0.001,  crashChance:0.05, moonChance:0.05, crashMag:0.50, moonMag:2.00 },
  stable:   { drift:0.002,  crashChance:0.02, moonChance:0.02, crashMag:0.25, moonMag:1.50 },
  volatile: { drift:0.000,  crashChance:0.08, moonChance:0.08, crashMag:0.65, moonMag:3.50 },
};

const VOL_MAP = { low:0.10, medium:0.25, high:0.40, extreme:0.55 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coincreate')
    .setDescription('Launch your own memecoin. Requires a Crypto Lab business. (3 max)')
    .addStringOption(o => o.setName('name').setDescription('Coin name (e.g. SupaCoin)').setRequired(true).setMaxLength(20))
    .addStringOption(o => o.setName('emoji').setDescription('Coin emoji').setRequired(true).setMaxLength(4))
    .addStringOption(o => o.setName('desc').setDescription('Short description').setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName('tendency').setDescription('Price tendency').setRequired(true)
      .addChoices(
        { name:'🚀 Moon — tends to pump', value:'moon' },
        { name:'🪤 Rug — tends to crash', value:'rug' },
        { name:'⚖️ Balanced — 50/50', value:'balanced' },
        { name:'🏦 Stable — slow movement', value:'stable' },
        { name:'💀 Volatile — total chaos', value:'volatile' },
      ))
    .addStringOption(o => o.setName('volatility').setDescription('How wild the swings are').setRequired(true)
      .addChoices(
        { name:'🟢 Low', value:'low' },
        { name:'🟡 Medium', value:'medium' },
        { name:'🟠 High', value:'high' },
        { name:'🔴 Extreme', value:'extreme' },
      ))
    .addNumberOption(o => o.setName('price').setDescription('Starting price in $').setRequired(false).setMinValue(0.01)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const userId = interaction.user.id;

    // Must own a Crypto Lab
    const biz = getBusiness(userId);
    if (!biz || biz.type !== 'cryptolab') {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('🖥️ Crypto Lab Required')
        .setDescription('You need to own a **Crypto Lab** business to launch coins.\n\nStart one with `/business start type:cryptolab`.')
      ], ephemeral: true });
    }

    const c = await col('customCoins');

    // Check existing coins by this owner (max 3)
    const owned = await c.find({ ownerId: userId }).toArray();
    if (owned.length >= 3) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('🚫 Coin Limit Reached')
        .setDescription(`You already have **${owned.length}/3** coins. Delete one first with \`/coinclose\`.`)
        .addFields({ name:'Your Coins', value: owned.map(c=>`${c.emoji} **${c.name}** (${c._id})`).join('\n') })
      ], ephemeral: true });
    }

    const name      = interaction.options.getString('name').trim();
    const emoji     = interaction.options.getString('emoji').trim();
    const desc      = interaction.options.getString('desc').trim();
    const tendency  = interaction.options.getString('tendency');
    const volatility= interaction.options.getString('volatility');
    const startPrice= interaction.options.getNumber('price') || 100;

    const id = name.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    if (!id) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Invalid coin name — use letters and numbers only.')], ephemeral:true });

    const existing = await c.findOne({ _id: id });
    if (existing) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`A coin with ticker **${id}** already exists. Try a different name.`)], ephemeral:true });

    const preset  = TENDENCY_PRESETS[tendency];
    const vol     = VOL_MAP[volatility];
    const COLORS_MAP = ['#f5c518','#2ecc71','#ff3b3b','#00d2ff','#9b59b6','#ff6b35','#e74c3c','#1abc9c'];
    const color   = COLORS_MAP[Math.floor(Math.random() * COLORS_MAP.length)];

    const profile = {
      name, emoji, color, desc, vol, ...preset, floor: 0.001,
      custom: true, ownerId: userId, tendency, volatility, createdAt: Date.now(),
    };

    await c.insertOne({ _id: id, ...profile });

    // Register with live tick engine
    try {
      const idx = require('../../index');
      if (idx.saveCustomCoin) await idx.saveCustomCoin(id, profile);
    } catch {}

    // Set starting price
    const pc = await col('stockPrices');
    const pdoc = await pc.findOne({ _id:'prices' });
    const prices = pdoc ? { ...pdoc } : {};
    delete prices._id;
    prices[id] = startPrice;
    await pc.replaceOne({ _id:'prices' }, { _id:'prices', ...prices }, { upsert:true });

    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`${emoji} ${name} (${id}) — Launched! 🚀`)
      .setDescription(`Your memecoin is now live on the market!\n\n*${desc}*`)
      .addFields(
        { name:'📊 Tendency',    value: tendency,   inline:true },
        { name:'💥 Volatility',  value: volatility, inline:true },
        { name:'💲 Start Price', value: `$${startPrice.toLocaleString()}`, inline:true },
        { name:'📈 Trade Now',   value: `Users can invest with \`/invest ${id} <amount>\``, inline:false },
      )
    ]});
  },
};
