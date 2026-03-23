const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getStore } = require('../../utils/db');
const { getGangByMember, saveGang } = require('../../utils/gangDb');
const { getGangGoons, saveGangGoons, hasAccountant } = require('../../utils/goonDb');
const { getBusiness, getBusinesses, getCashBusinesses, saveBusiness, BIZ_TYPES } = require('../../utils/bizDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const LAUNDER_CUT = 0.25; // 25% lost laundering fee

module.exports = {
  data: new SlashCommandBuilder()
    .setName('launder')
    .setDescription('Launder your gang\'s dirty money through a cash business.')
    .addIntegerOption(o => o.setName('amount').setDescription('Dirty money to launder (default: all)').setRequired(false).setMinValue(1)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const userId = interaction.user.id;
    const gang   = getGangByMember(userId);
    if (!gang) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You're not in a gang.")], ephemeral:true });
    if (gang.leaderId !== userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Only the gang leader can launder money.")], ephemeral:true });

    const goonData = getGangGoons(gang.id);
    const dirty    = goonData.dirtyMoney || 0;

    if (dirty < 1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription('No dirty money to launder. Goons generate dirty money automatically — check `/goons roster`.')
    ], ephemeral:true });

    // Prefer cash businesses (lower fee). If none, fall back to legit.
    const cashBizs = getCashBusinesses(userId);
    const legitBiz = getBusiness(userId);
    const biz      = cashBizs.length ? cashBizs[0] : legitBiz;
    const bizType  = biz ? BIZ_TYPES[biz.type] : null;
    if (!biz || !bizType) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('💸 No Business')
        .setDescription('You need a **business** to launder money through.\n\n🫧 **Cash businesses** (lower fee, gang leader only): Laundromat · Cash Car Wash · Nightclub\n💼 **Legit businesses** (higher fee): any business\n\nStart one with `/business start`.')
      ], ephemeral:true });
    }

    // Accountant reduces launder fee. Cash business = base 20%, legit = base 35%
    const hasAcct   = hasAccountant(goonData.goons||[]);
    const baseFee   = bizType.isCashBusiness ? 0.20 : 0.35;
    const fee       = hasAcct ? baseFee * 0.40 : baseFee; // accountant cuts fee by 60%
    const amount  = Math.min(interaction.options.getInteger('amount') || dirty, dirty);
    const clean   = Math.floor(amount * (1 - fee));
    const lost    = amount - clean;

    // Move dirty → clean business revenue
    goonData.dirtyMoney = Math.max(0, dirty - amount);
    await saveGangGoons(gang.id, goonData);

    biz.revenue    = (biz.revenue||0) + clean;
    biz.totalEarned= (biz.totalEarned||0) + clean;
    await saveBusiness(userId, biz);

    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🫧 Money Laundered')
      .setDescription(`Dirty money has been cleaned through your **${bizType.emoji} ${bizType.name}**.`)
      .addFields(
        { name:'💊 Dirty In',     value:`$${amount.toLocaleString()}`,  inline:true },
        { name:'✅ Clean Out',    value:`$${clean.toLocaleString()}`,   inline:true },
        { name:'✂️ Fee',         value:`${Math.round(fee*100)}%${hasAcct?' (🧾 Accountant discount)':''}${bizType.isCashBusiness?' (Cash Business)':' (Legit Business)'}`, inline:true },
        { name:'🏦 Business Rev', value:`$${biz.revenue.toLocaleString()} ready to collect`, inline:true },
        { name:'💰 Dirty Left',  value:`$${goonData.dirtyMoney.toLocaleString()}`, inline:true },
      )
      .setFooter({ text: hasAcct ? '🧾 NPC Accountant reduced your laundering fee to 10%!' : 'Hire an NPC Accountant (/goons hire type:accountant) to reduce fee to 10%' })
    ]});
  },
};
