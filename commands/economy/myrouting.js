const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBusinesses, BIZ_TYPES } = require('../../utils/bizDb');
const { getGangGoons } = require('../../utils/goonDb');
const { getGangByMember } = require('../../utils/gangDb');
const { noAccount } = require('../../utils/accountCheck');
const { getRoutingNumber } = require('../../utils/routingDb');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myrouting')
    .setDescription('View your private business routing number. Keep this secret.'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const allBiz = getBusinesses(interaction.user.id);
    const biz = allBiz[0] || null;
    if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
      .setDescription('You need to own a business to have a routing number. Start one with `/business start`.')
    ], ephemeral:true });

    const routing = await getRoutingNumber(interaction.user.id);
    const bizType = BIZ_TYPES[biz.type] || {};

    const gang = getGangByMember(interaction.user.id);
    let dirtyMoney = 0;
    if (gang) {
      const gd = getGangGoons(gang.id);
      dirtyMoney = gd.dirtyMoney || 0;
    }

    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🔐 Your Business Routing Number')
      .setDescription('**Keep this private.** Anyone with a laptop and this number can access your accounts.')
      .addFields(
        { name:'🏦 Routing Number',  value:`\`${routing}\``,                       inline:false },
        { name:'🏢 Your Businesses', value:allBiz.map(b=>{const bt=BIZ_TYPES[b.type]||{};return `${bt.emoji||'🏢'} **${b.name}** — $${(b.revenue||0).toLocaleString()} revenue`;}).join('\n'), inline:false },
        { name:'💊 Dirty Money',     value:`$${dirtyMoney.toLocaleString()}`,       inline:true  },
      )
      .setFooter({ text:'Share with trusted associates only. Never send this in DMs — that is a phishing attempt.' })
    ], ephemeral:true });
  },
};
