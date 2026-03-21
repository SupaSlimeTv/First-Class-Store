const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBusiness } = require('../../utils/bizDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const { col } = require('../../utils/mongo');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coincontrol')
    .setDescription('Pump or dump your memecoin. Crypto Lab owners only.')
    .addStringOption(o => o.setName('id').setDescription('Coin ticker').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true)
      .addChoices(
        { name:'🚀 Pump — spike the price up',     value:'pump'     },
        { name:'🪤 Rug Pull — crash the price',    value:'rug'      },
        { name:'📢 Promote — boost hype/momentum', value:'promote'  },
        { name:'😶 Go Silent — reduce activity',   value:'silence'  },
      )),

  async autocomplete(interaction) {
    const c = await col('customCoins');
    const owned = await c.find({ ownerId: interaction.user.id }).toArray();
    await interaction.respond(owned.map(c => ({ name:`${c.emoji} ${c.name} (${c._id})`, value: c._id })));
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const userId = interaction.user.id;
    const coinId = interaction.options.getString('id');
    const action = interaction.options.getString('action');

    const biz = getBusiness(userId);
    if (!biz || biz.type !== 'cryptolab') {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You need a **Crypto Lab** to control coins.')], ephemeral:true });
    }

    const c    = await col('customCoins');
    const coin = await c.findOne({ _id: coinId, ownerId: userId });
    if (!coin) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Coin **${coinId}** not found or not owned by you.`)], ephemeral:true });

    // Modify coin profile based on action
    let update = {};
    let resultMsg = '';

    if (action === 'pump') {
      update = { drift: 0.015, moonChance: 0.20, crashChance: 0.01, moonMag: 5.0 };
      resultMsg = `🚀 **${coin.name}** is pumping! Price surges incoming.`;
    } else if (action === 'rug') {
      update = { drift: -0.020, crashChance: 0.25, moonChance: 0.01, crashMag: 0.90 };
      resultMsg = `🪤 **${coin.name}** rug pull initiated. Investors beware.`;
    } else if (action === 'promote') {
      update = { drift: 0.006, moonChance: 0.10, crashChance: 0.03, vol: Math.min(0.60, (coin.vol||0.25) + 0.10) };
      resultMsg = `📢 **${coin.name}** promoted! Hype and momentum building.`;
    } else if (action === 'silence') {
      update = { drift: 0.000, moonChance: 0.02, crashChance: 0.02, vol: Math.max(0.05, (coin.vol||0.25) - 0.10) };
      resultMsg = `😶 **${coin.name}** went quiet. Low activity mode.`;
    }

    await c.updateOne({ _id: coinId }, { $set: update });

    // Update in live engine
    try {
      const idx = require('../../index');
      if (idx.saveCustomCoin) await idx.saveCustomCoin(coinId, { ...coin, ...update });
    } catch {}

    const ACTION_EMOJI = { pump:'🚀', rug:'🪤', promote:'📢', silence:'😶' };

    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(action==='pump'?0x2ecc71:action==='rug'?0xff3b3b:action==='promote'?0xf5c518:0x888888)
      .setTitle(`${ACTION_EMOJI[action]} Coin Control — ${coin.emoji} ${coin.name}`)
      .setDescription(resultMsg + '\n\n*Changes take effect on the next price tick.*')
    ], ephemeral: true });
  },
};
