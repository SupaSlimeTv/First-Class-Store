// ============================================================
// commands/economy/sponsordeal.js
// Business owners offer paid sponsor deals to influencers
// Influencer accepts → their posts promote the business
// → business revenue increases per promotion
// ============================================================

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getBusiness, saveBusiness, BIZ_TYPES } = require('../../utils/bizDb');
const { getPhone, savePhone, getStatusTier, PHONE_TYPES, STATUS_TIERS } = require('../../utils/phoneDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const { col } = require('../../utils/mongo');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();

// Track active biz sponsorships: bizOwnerId -> [{ influencerId, boost, expiresAt }]
async function getBizSponsorships(ownerId) {
  const c   = await col('bizSponsorships');
  const doc = await c.findOne({ _id: ownerId });
  return doc?.deals || [];
}

async function saveBizSponsorships(ownerId, deals) {
  const c = await col('bizSponsorships');
  await c.replaceOne({ _id: ownerId }, { _id: ownerId, deals }, { upsert: true });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sponsordeal')
    .setDescription('Offer a paid sponsorship to an influencer to promote your business.')
    .addSubcommand(s => s.setName('offer').setDescription('Offer a sponsorship deal to an influencer')
      .addUserOption(o => o.setName('influencer').setDescription('Influencer to sponsor').setRequired(true))
      .addIntegerOption(o => o.setName('payout').setDescription('How much you pay the influencer ($)').setRequired(true).setMinValue(100))
      .addIntegerOption(o => o.setName('duration').setDescription('Deal duration in hours (default 24)').setRequired(false).setMinValue(1).setMaxValue(168))
      .addStringOption(o => o.setName('message').setDescription('What to say in the offer').setRequired(false).setMaxLength(200)))
    .addSubcommand(s => s.setName('view').setDescription('View your active sponsorships and their revenue boost')),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // ── VIEW ─────────────────────────────────────────────────
    if (sub === 'view') {
      const biz = getBusiness(userId);
      if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a business. Start one with `/business start`.")], ephemeral:true });

      const deals = await getBizSponsorships(userId);
      const active = deals.filter(d => d.expiresAt > Date.now());

      if (!active.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x5865f2)
        .setTitle('🤝 Your Sponsorships')
        .setDescription('No active sponsorships.\n\nUse `/sponsordeal offer @influencer` to hire an influencer to promote your business.')
      ], ephemeral:true });

      const lines = await Promise.all(active.map(async d => {
        const phone = getPhone(d.influencerId);
        const tier  = phone ? getStatusTier(phone.status||0) : null;
        const left  = Math.ceil((d.expiresAt - Date.now()) / 3600000);
        return `${tier?.label||'Unknown'} <@${d.influencerId}> — **+${Math.round(d.boost*100)}%** revenue boost · ${left}h left`;
      }));

      const totalBoost = active.reduce((s,d) => s + d.boost, 0);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`🤝 Active Sponsorships — ${biz.name}`)
        .setDescription(lines.join('\n'))
        .addFields({ name:'📈 Total Revenue Boost', value:`+${Math.round(totalBoost*100)}%`, inline:true })
      ], ephemeral:true });
    }

    // ── OFFER ────────────────────────────────────────────────
    if (sub === 'offer') {
      const biz = getBusiness(userId);
      if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You need to own a business to offer sponsorships.")], ephemeral:true });

      const target   = interaction.options.getUser('influencer');
      const payout   = interaction.options.getInteger('payout');
      const duration = interaction.options.getInteger('duration') || 24;
      const message  = interaction.options.getString('message') || null;

      if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't sponsor yourself.")], ephemeral:true });

      // Check influencer has a phone
      const phone = getPhone(target.id);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> doesn't have a phone — they can't accept sponsorships.`)], ephemeral:true });

      const tier  = getStatusTier(phone.status||0);
      const pType = PHONE_TYPES[phone.type] || PHONE_TYPES.standard;

      // Check business owner has enough money
      const owner = getOrCreateUser(userId);
      if (owner.wallet < payout) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You need **${fmtMoney(payout)}** in your wallet to offer this deal. You have **${fmtMoney(owner.wallet)}**.`)
      ], ephemeral:true });

      // Revenue boost scales with influencer tier (0.5% per coinHypeMult point)
      const revenueBoost = Math.min(2.0, tier.coinHypeMult * 0.05 * (phone.coinShoutoutMult||1)); // up to 200% boost

      const bizType = BIZ_TYPES[biz.type] || {};

      await interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🤝 Sponsorship Offer')
        .setDescription(`<@${userId}> wants to sponsor **<@${target.id}>** to promote **${bizType.emoji||'🏢'} ${biz.name}**!\n\n${message ? `*"${message}"*\n\n` : ''}<@${target.id}> — do you accept?`)
        .addFields(
          { name:'💵 Your Payout',      value:fmtMoney(payout),                          inline:true },
          { name:'⏱️ Duration',          value:`${duration} hour${duration!==1?'s':''}`, inline:true },
          { name:'📊 Your Tier',         value:tier.label,                                inline:true },
          { name:'📈 Business Boost',    value:`+${Math.round(revenueBoost*100)}% revenue/hr`, inline:true },
          { name:'👥 Your Followers',    value:(phone.followers||0).toLocaleString(),     inline:true },
          { name:'🏢 Business',          value:biz.name,                                  inline:true },
        )
        .setFooter({ text:'Offer expires in 60 seconds' })
      ], components:[new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('sp_accept').setLabel('✅ Accept Deal').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('sp_decline').setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
      )]});

      const collector = interaction.channel.createMessageComponentCollector({
        filter: btn => btn.user.id === target.id,
        time: 60_000, max: 1,
      });

      collector.on('collect', async btn => {
        if (btn.customId === 'sp_decline') {
          return btn.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription(`<@${target.id}> declined the sponsorship.`)
          ], components:[] });
        }

        // Accept — deduct payout from business owner, give to influencer
        const freshOwner = getOrCreateUser(userId);
        if (freshOwner.wallet < payout) {
          return btn.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription("The business owner no longer has enough money for this deal.")
          ], components:[] });
        }

        freshOwner.wallet -= payout;
        saveUser(userId, freshOwner);

        const freshInfluencer = getOrCreateUser(target.id);
        freshInfluencer.wallet += payout;
        saveUser(target.id, freshInfluencer);

        // Add deal to influencer's phone
        const freshPhone = getPhone(target.id);
        freshPhone.sponsorDeals = [...(freshPhone.sponsorDeals||[]), {
          name:    `🏢 ${biz.name} Sponsorship`,
          payout,
          active:  false, // already paid, mark as collected
          bizOwner: userId,
          bizName:  biz.name,
          createdAt: Date.now(),
          collectedAt: Date.now(),
          bizSponsored: true,
        }];
        await savePhone(target.id, freshPhone);

        // Register active sponsorship on the business
        const deals = await getBizSponsorships(userId);
        const expiresAt = Date.now() + duration * 3600000;
        deals.push({ influencerId: target.id, boost: revenueBoost, expiresAt, payout, duration });
        // Remove expired
        const active = deals.filter(d => d.expiresAt > Date.now());
        await saveBizSponsorships(userId, active);

        // DM the influencer
        await target.send({ embeds:[new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('🤝 Sponsorship Accepted!')
          .setDescription(`You accepted a sponsorship from **${biz.name}**!\n\n**${fmtMoney(payout)}** has been added to your wallet.\n\nThis sponsorship runs for **${duration} hours** and boosts their business revenue.`)
        ]}).catch(()=>{});

        return btn.update({ embeds:[new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('✅ Sponsorship Active!')
          .setDescription(`<@${target.id}> accepted the deal!\n\n**${biz.name}** is now sponsored by **${tier.label} <@${target.id}>**.\n\n📈 Revenue boost: **+${Math.round(revenueBoost*100)}%/hr** for **${duration} hours**.`)
        ], components:[] });
      });

      collector.on('end', (_, reason) => {
        if (reason === 'time') interaction.editReply({ components:[] }).catch(()=>{});
      });
    }
  },
};
