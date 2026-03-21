const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getBusiness, saveBusiness } = require('../../utils/bizDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const { col } = require('../../utils/mongo');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('liquidate')
    .setDescription('Collect accumulated investment revenue from your Crypto Lab coins.'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const userId = interaction.user.id;

    const biz = getBusiness(userId);
    if (!biz || biz.type !== 'cryptolab') {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('🖥️ Crypto Lab Required')
        .setDescription('You need a **Crypto Lab** business to collect coin revenue.\n\nStart one with `/business start type:cryptolab`.')
      ], ephemeral:true });
    }

    const revenue = biz.revenue || 0;
    if (revenue < 1) {
      // Show current coins and explain how revenue works
      const c    = await col('customCoins');
      const coins = await c.find({ ownerId: userId }).toArray();
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x888888)
        .setTitle('🖥️ Crypto Lab — No Revenue Ready')
        .setDescription('No coin investment revenue to collect yet.\n\nRevenue builds up as users invest in your coins — **10% of every investment** goes to your lab.')
        .addFields(
          { name:'🪙 Your Coins', value: coins.length ? coins.map(c=>`${c.emoji} **${c.name}** (${c._id})`).join('\n') : 'No coins launched yet. Use `/coincreate`.' , inline:false },
          { name:'💡 How it works', value:'Every time someone does `/invest <yourcoin>`, 10% goes into your Revenue Ready. Collect it here anytime with `/coincollect`, or it auto-collects with `/business collect`.', inline:false },
        )
      ], ephemeral:true });
    }

    const user       = getOrCreateUser(userId);
    user.wallet     += revenue;
    biz.revenue      = 0;
    biz.totalEarned  = (biz.totalEarned || 0) + revenue;
    saveUser(userId, user);
    await saveBusiness(userId, biz);

    // Show which coins contributed
    const c     = await col('customCoins');
    const coins = await c.find({ ownerId: userId }).toArray();

    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🖥️ Coin Revenue Collected!')
      .setDescription(`You collected **$${revenue.toLocaleString()}** from your Crypto Lab!`)
      .addFields(
        { name:'💰 Collected',    value:`$${revenue.toLocaleString()}`,       inline:true },
        { name:'💵 New Wallet',   value:`$${user.wallet.toLocaleString()}`,   inline:true },
        { name:'🪙 Active Coins', value: coins.length ? coins.map(c=>`${c.emoji} ${c.name} (${c._id})`).join(' · ') : 'None', inline:false },
        { name:'💡 Tip', value:'Revenue builds automatically as users invest in your coins. Use `/coincontrol` to pump or promote your coins for more investment.', inline:false },
      )
      .setFooter({ text:'Use /rugpull to delist a coin and collect all revenue at once' })
    ]});
  },
};
