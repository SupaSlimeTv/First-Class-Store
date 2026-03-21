const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getBusiness: getbiz } = require('../../utils/db');
const { getBusiness, saveBusiness } = require('../../utils/bizDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const { col } = require('../../utils/mongo');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rugpull')
    .setDescription('Rug pull — delist your memecoin and collect all remaining revenue.')
    .addStringOption(o => o.setName('id').setDescription('Coin ticker ID').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const c     = await col('customCoins');
    const owned = await c.find({ ownerId: interaction.user.id }).toArray();
    await interaction.respond(owned.map(c => ({ name:`${c.emoji} ${c.name} (${c._id})`, value: c._id })));
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const userId = interaction.user.id;
    const coinId = interaction.options.getString('id');

    const biz = getBusiness(userId);
    if (!biz || biz.type !== 'cryptolab') {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You need a **Crypto Lab** to manage coins.')], ephemeral:true });
    }

    const c    = await col('customCoins');
    const coin = await c.findOne({ _id: coinId, ownerId: userId });
    if (!coin) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Coin **${coinId}** not found or not owned by you.`)], ephemeral:true });

    // Collect all accumulated revenue from business before delisting
    const pendingRevenue = biz.revenue || 0;
    let collected = 0;
    if (pendingRevenue > 0) {
      const user    = getOrCreateUser(userId);
      collected     = pendingRevenue;
      user.wallet  += collected;
      biz.revenue   = 0;
      biz.totalEarned = (biz.totalEarned || 0) + collected;
      saveUser(userId, user);
      await saveBusiness(userId, biz);
    }

    // Crash the coin price to near zero before delisting (so investors know it's over)
    try {
      const pc   = await col('stockPrices');
      const pdoc = await pc.findOne({ _id: 'prices' });
      if (pdoc) {
        const prices = { ...pdoc };
        prices[coinId] = 0.0001;
        await pc.replaceOne({ _id:'prices' }, prices );
      }
    } catch {}

    // Delete the coin
    await c.deleteOne({ _id: coinId });
    try {
      const idx = require('../../index');
      if (idx.deleteCustomCoin) await idx.deleteCustomCoin(coinId);
    } catch {}

    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(0xff3b3b)
      .setTitle(`🪤 ${coin.emoji} ${coin.name} — RUG PULLED`)
      .setDescription(`**${coin.name}** (${coinId}) has been delisted. Price crashed to $0. All investor holdings are now worthless.`)
      .addFields(
        { name:'💰 Revenue Collected', value:`$${collected.toLocaleString()}`, inline:true },
        { name:'💵 Added to Wallet',   value: collected > 0 ? `+$${collected.toLocaleString()}` : '$0 (was empty)', inline:true },
      )
    ]});
  },
};
