const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBusiness } = require('../../utils/bizDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const { col } = require('../../utils/mongo');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rugpull')
    .setDescription('Rug pull — delist and crash one of your memecoins.')
    .addStringOption(o => o.setName('id').setDescription('Coin ticker ID').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const c = await col('customCoins');
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

    await c.deleteOne({ _id: coinId });

    try {
      const idx = require('../../index');
      if (idx.deleteCustomCoin) await idx.deleteCustomCoin(coinId);
    } catch {}

    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(0x888888)
      .setTitle(`${coin.emoji} ${coin.name} Delisted`)
      .setDescription(`**${coin.name}** (${coinId}) has been removed from the market. All investments in this coin are now worthless.`)
    ]});
  },
};
