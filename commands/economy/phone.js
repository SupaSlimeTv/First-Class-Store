const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser, getStore, hasAccount, getConfig } = require('../../utils/db');
const { getPhone, savePhone, getAllPhones, PLATFORMS, PHONE_TYPES, STATUS_TIERS, getStatusTier, getNextStatusTier, SPONSOR_DEALS, defaultPhone } = require('../../utils/phoneDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => n >= 1e6 ? '$' + (n/1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + Math.round(n).toLocaleString() : '$' + n;
const fmtNum   = n => n >= 1e6 ? (n/1e6).toFixed(1) + 'M' : n >= 1e3 ? (n/1e3).toFixed(1) + 'K' : n.toString();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('phone')
    .setDescription('📱 Post, build your brand, call police, check stats.')
    .addSubcommand(s => s.setName('buy').setDescription('Buy a phone')
      .addStringOption(o => o.setName('type').setDescription('Phone type').setRequired(true)
        .addChoices(...Object.entries(PHONE_TYPES).map(([id,t])=>({ name:`${t.emoji} ${t.name} — $${t.cost.toLocaleString()}`, value:id })))))
    .addSubcommand(s => s.setName('post').setDescription('Post on social media')
      .addStringOption(o => o.setName('platform').setDescription('Platform').setRequired(true)
        .addChoices(...Object.entries(PLATFORMS).map(([id,p])=>({ name:`${p.emoji} ${p.name}`, value:id }))))
      .addStringOption(o => o.setName('content').setDescription('What are you posting? (optional)').setRequired(false).setMaxLength(200)))
    .addSubcommand(s => s.setName('status').setDescription('View your influencer status and stats'))
    .addSubcommand(s => s.setName('leaderboard').setDescription('Top influencers by status'))
    .addSubcommand(s => s.setName('shoutout').setDescription('🌟 Celebrity+ only — Shout out a coin to your fans. Boosts price & hype.')
      .addStringOption(o => o.setName('coin').setDescription('Coin ticker to shout out (e.g. DOGE2)').setRequired(true).setMaxLength(10))
      .addStringOption(o => o.setName('message').setDescription('What to say about the coin').setRequired(false).setMaxLength(200)))
    .addSubcommand(s => s.setName('sponsors').setDescription('View and collect sponsor deals'))
    .addSubcommand(s => s.setName('calpolice').setDescription('Call police on a user (false reports = YOU get jailed)')
      .addUserOption(o => o.setName('user').setDescription('Who to report').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('What are you reporting?').setRequired(true).setMaxLength(200))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // ── BUY ─────────────────────────────────────────────────
    if (sub === 'buy') {
      const typeId = interaction.options.getString('type');
      const pType  = PHONE_TYPES[typeId];
      if (getPhone(userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('You already have a phone. Upgrade it using `/phone buy` with a better tier — this replaces your current phone but keeps your status and followers.')
      ], ephemeral:true });

      const user = getOrCreateUser(userId);
      if (user.wallet < pType.cost) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You need **${fmtMoney(pType.cost)}** but only have **${fmtMoney(user.wallet)}**.`)
      ], ephemeral:true });

      user.wallet -= pType.cost;
      saveUser(userId, user);
      const phone = defaultPhone(typeId);
      await savePhone(userId, phone);

      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x5865f2)
        .setTitle(`${pType.emoji} ${pType.name} Activated!`)
        .setDescription(`*${pType.desc}*\n\nYour influencer career starts now. Post consistently to build **Status** and unlock bigger deals.\n\n**Status determines everything:**\n✨ Hype multiplier\n💰 Sponsorship payouts\n📣 Coin shoutout power\n👥 NPC fan loyalty`)
        .addFields(
          { name:'📸 Flexgram',  value:'`/phone post platform:flexgram`',  inline:true },
          { name:'🐦 Chirp',     value:'`/phone post platform:chirp`',     inline:true },
          { name:'🎮 Streamz',   value:'`/phone post platform:streamz`',   inline:true },
          { name:'📊 Stats',     value:'`/phone status`',                  inline:true },
          { name:'🤝 Sponsors',  value:'`/phone sponsors`',                inline:true },
          { name:'💵 Wallet',    value:fmtMoney(user.wallet),              inline:true },
        )
      ]});
    }

    // ── STATUS ───────────────────────────────────────────────
    if (sub === 'status') {
      const phone = getPhone(userId);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No phone yet. Buy one with `/phone buy`.')], ephemeral:true });

      const tier     = getStatusTier(phone.status || 0);
      const nextTier = getNextStatusTier(phone.status || 0);
      const pType    = PHONE_TYPES[phone.type] || PHONE_TYPES.burner;
      const activeSponsor = (phone.sponsorDeals||[]).filter(s=>s.active).length;
      const progressPct = nextTier ? Math.min(100, Math.round(((phone.status||0) - tier.minStatus) / (nextTier.minStatus - tier.minStatus) * 100)) : 100;
      const bar = '█'.repeat(Math.floor(progressPct/10)) + '░'.repeat(10 - Math.floor(progressPct/10));

      // Platform cooldowns
      const platformLines = Object.entries(PLATFORMS).map(([id,p]) => {
        const last = phone.lastPost?.[id] || 0;
        const ready = Date.now() - last > p.cooldownMs;
        const left  = ready ? 0 : Math.ceil((p.cooldownMs - (Date.now()-last))/60000);
        return `${p.emoji} **${p.name}** — ${ready ? '✅ Ready' : `⏳ ${left}m`}`;
      }).join('\n');

      return interaction.reply({ embeds:[new EmbedBuilder().setColor(tier.color)
        .setTitle(`${pType.emoji} ${interaction.user.username} — ${tier.label}`)
        .setDescription(`*${fmtNum(tier.fanCount)} NPC fans follow you faithfully.*`)
        .addFields(
          { name:'🏆 Status',        value:`${(phone.status||0).toLocaleString()} pts`,   inline:true },
          { name:'👥 Followers',     value:fmtNum(phone.followers||0),                    inline:true },
          { name:'✨ Total Hype',    value:(phone.hype||0).toLocaleString(),               inline:true },
          { name:'💰 Total Earned',  value:fmtMoney(phone.totalEarned||0),                inline:true },
          { name:'📝 Total Posts',   value:(phone.totalPosts||0).toString(),               inline:true },
          { name:'🤝 Active Deals',  value:activeSponsor.toString(),                       inline:true },
          { name:'📱 Phone',         value:`${pType.emoji} ${pType.name}`,                 inline:true },
          { name:'🔥 Streak',        value:`${phone.streak||0} day${phone.streak!==1?'s':''}`, inline:true },
          { name:'💎 Status Mult',   value:`${tier.mult}×`,                               inline:true },
          { name:'📣 Platforms',     value:platformLines,                                  inline:false },
          { name:nextTier ? `Next: ${nextTier.label}` : '👑 Max Status Reached',
            value:nextTier ? `\`[${bar}] ${progressPct}%\`\n${(nextTier.minStatus-(phone.status||0)).toLocaleString()} status needed` : `You are at the pinnacle.`,
            inline:false },
        )
        .setFooter({ text:`Coin shoutout power: ${tier.coinHypeMult}× · Sponsor slots: ${tier.sponsorSlots}` })
      ]});
    }

    // ── POST ─────────────────────────────────────────────────
    if (sub === 'post') {
      const phone = getPhone(userId);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No phone. Buy one with `/phone buy`.')], ephemeral:true });

      const platformId = interaction.options.getString('platform');
      const content    = interaction.options.getString('content') || '';
      const platform   = PLATFORMS[platformId];
      const pType      = PHONE_TYPES[phone.type] || PHONE_TYPES.burner;
      const tier       = getStatusTier(phone.status || 0);

      if (!platform) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Invalid platform selected.')], ephemeral:true });

      // Cooldown check
      const lastPost = phone.lastPost?.[platformId] || 0;
      if (Date.now() - lastPost < platform.cooldownMs) {
        const mins = Math.ceil((platform.cooldownMs - (Date.now()-lastPost)) / 60000);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`${platform.emoji} **${platform.name}** cooldown: **${mins} more minutes**.`)
        ], ephemeral:true });
      }

      await interaction.deferReply();

      // ── Calculate earnings with status multiplier ──────────
      const statusMult  = tier.mult;
      const phoneBonus  = 1 + (pType.hypeBonus || 0);
      const randFactor  = 0.6 + Math.random() * 0.8;

      // Status gain this post
      const statusGained = Math.floor(platform.statusGain * phoneBonus * randFactor);

      // Hype
      const baseHype  = Math.floor(platform.baseHype * statusMult * phoneBonus * randFactor);
      // Money
      const baseMoney = Math.floor(platform.baseMoney * statusMult * phoneBonus * randFactor);
      // Followers
      const followers = Math.floor((baseHype / 8) * (0.5 + Math.random()));

      // Viral chance scales with status and phone
      const viralChance = 0.04 + (tier.mult - 1) * 0.02 + (pType.hypeBonus * 0.05);
      const isViral     = Math.random() < viralChance;
      const viralMult   = isViral ? (2 + Math.random() * (tier.mult)) : 1;

      const finalHype    = Math.floor(baseHype * viralMult);
      const finalMoney   = Math.floor(baseMoney * viralMult);
      const finalFollowers = Math.floor(followers * viralMult);
      const finalStatus  = Math.floor(statusGained * viralMult);

      // Streak bonus
      const today = new Date().toDateString();
      const wasStreakDay = phone.lastStreakDay === new Date(Date.now() - 86400000).toDateString();
      if (wasStreakDay) phone.streak = (phone.streak || 0) + 1;
      else if (phone.lastStreakDay !== today) phone.streak = 1;
      phone.lastStreakDay = today;
      const streakBonus = Math.min(2.0, 1 + (phone.streak - 1) * 0.05); // up to 2x at 20 day streak

      const realMoney    = Math.floor(finalMoney * streakBonus);
      const realStatus   = Math.floor(finalStatus * streakBonus);

      // Update phone
      phone.status     = (phone.status || 0) + realStatus;
      phone.hype       = (phone.hype || 0) + finalHype;
      phone.followers  = (phone.followers || 0) + finalFollowers;
      phone.totalPosts = (phone.totalPosts || 0) + 1;
      phone.totalEarned= (phone.totalEarned || 0) + realMoney;
      phone.lastPost   = { ...(phone.lastPost||{}), [platformId]: Date.now() };
      phone.influence  = Math.min(100, (phone.influence||0) + finalHype / 200);

      // ── Sponsor check ─────────────────────────────────────
      let sponsorMsg = '';
      const newTier = getStatusTier(phone.status);
      if (newTier.id !== tier.id) {
        // Just ranked up — give sponsor deal
        const deals = SPONSOR_DEALS[newTier.id] || [];
        if (deals.length && (phone.sponsorDeals||[]).filter(s=>s.active).length < newTier.sponsorSlots) {
          const deal = { ...deals[Math.floor(Math.random()*deals.length)], active:true, createdAt:Date.now() };
          phone.sponsorDeals = [...(phone.sponsorDeals||[]), deal];
          sponsorMsg = `\n\n🎊 **STATUS UP! → ${newTier.label}**\n🤝 New sponsor unlocked: **${deal.name}** — $${deal.payout.toLocaleString()}! Collect with \`/phone sponsors\``;
        } else {
          sponsorMsg = `\n\n🎊 **STATUS UP! → ${newTier.label}**\n${fmtNum(newTier.fanCount)} NPC fans now follow you!`;
        }
      }

      // Pay the user
      const user = getOrCreateUser(userId);
      user.wallet += realMoney;
      saveUser(userId, user);
      await savePhone(userId, phone);

      const viralLine = isViral ? '\n\n🚀 **THIS WENT VIRAL!!**' : '';
      const streakLine = phone.streak > 1 ? ` · 🔥 ${phone.streak}-day streak (+${Math.round((streakBonus-1)*100)}%)` : '';

      return interaction.editReply({ embeds:[new EmbedBuilder()
        .setColor(isViral ? 0xf5c518 : newTier.color || 0x5865f2)
        .setTitle(`${platform.emoji} Posted on ${platform.name}${isViral ? ' 🚀 VIRAL!' : ''}`)
        .setDescription(`${content ? `*"${content}"*\n\n` : ''}${viralLine}${sponsorMsg}`)
        .addFields(
          { name:'🏆 Status +',      value:`+${realStatus.toLocaleString()} → **${phone.status.toLocaleString()}**`, inline:true },
          { name:'✨ Hype +',        value:`+${finalHype.toLocaleString()}`,                                          inline:true },
          { name:'👥 Followers +',   value:`+${finalFollowers.toLocaleString()}`,                                     inline:true },
          { name:'💵 Earned',        value:`+${fmtMoney(realMoney)}${streakLine}`,                                    inline:true },
          { name:'💎 Status Mult',   value:`${newTier.mult}×`,                                                        inline:true },
          { name:'💰 Wallet',        value:fmtMoney(user.wallet),                                                     inline:true },
        )
        .setFooter({ text:`${newTier.label} · Next post in ${Math.ceil(platform.cooldownMs/60000)}min` })
      ]});
    }

    // ── LEADERBOARD ──────────────────────────────────────────
    if (sub === 'leaderboard') {
      const all = getAllPhones();
      const sorted = Object.entries(all)
        .map(([id, p]) => ({ id, status:p.status||0, followers:p.followers||0, tier:getStatusTier(p.status||0), type:PHONE_TYPES[p.type]||PHONE_TYPES.burner }))
        .sort((a,b) => b.status - a.status)
        .slice(0, 10);

      if (!sorted.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x5865f2).setDescription('No influencers yet.')], ephemeral:true });

      const medals = ['🥇','🥈','🥉'];
      const lines  = sorted.map((p,i) => `${medals[i]||`**${i+1}.**`} <@${p.id}> ${p.tier.label} — **${p.status.toLocaleString()}** status · ${fmtNum(p.followers)} followers`);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('📱 Influencer Leaderboard')
        .setDescription(lines.join('\n'))
      ]});
    }

    // ── SHOUTOUT ─────────────────────────────────────────────
    if (sub === 'shoutout') {
      const phone = getPhone(userId);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No phone. Buy one with `/phone buy`.')], ephemeral:true });

      const tier = getStatusTier(phone.status || 0);

      // Celebrity+ only
      const REQUIRED_TIERS = ['celebrity','superstar','icon'];
      if (!REQUIRED_TIERS.includes(tier.id)) {
        const celebrityTier = STATUS_TIERS.find(t => t.id === 'celebrity');
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setTitle('⭐ Celebrity Required')
          .setDescription(`Coin shoutouts are only available to **⭐ Celebrity** and above.\n\nYour current status: **${tier.label}**\n\nYou need **${((celebrityTier.minStatus - (phone.status||0)).toLocaleString())}** more status points to unlock shoutouts.\n\nKeep posting to level up!`)
        ], ephemeral:true });
      }

      const ticker  = interaction.options.getString('coin').toUpperCase().trim();
      const message = interaction.options.getString('message') || null;

      await interaction.deferReply();

      // Look up coin
      const { col } = require('../../utils/mongo');
      const cc   = await col('customCoins');
      const coin = await cc.findOne({ _id: ticker }).catch(()=>null);

      if (!coin) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Coin **${ticker}** not found on the market. Check the ticker and try again.\n\nUse \`/market\` to see available coins.`)
      ]});

      // 30 min cooldown per coin per user (configurable via dashboard)
      const { getConfig, getOrCreateUser: gocUser, saveUser: sUser } = require('../../utils/db');
      const config    = getConfig(interaction.guild.id);
      const SHOUT_CD  = (config.shoutoutCooldownMins || 30) * 60 * 1000;
      const lastShout = (phone.lastShoutout||{})[ticker] || 0;
      if (Date.now() - lastShout < SHOUT_CD) {
        const mins = Math.ceil((SHOUT_CD - (Date.now()-lastShout))/60000);
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`You already shouted out **${ticker}** recently. Wait **${mins}m** before shouting it out again.`)
        ]});
      }

      // ── CALCULATE SHOUTOUT POWER ──────────────────────────────
      const customMult  = phone.coinShoutoutMult || 1.0;
      const totalPower  = tier.coinHypeMult * customMult;

      // Price boost — scales massively with tier (up to 8× for Cultural Icon)
      const priceBoost  = Math.min(8.0, 1 + (totalPower * 0.15));

      // Fan investment — % of NPC fans "buy in" driving fake volume
      const investingFans   = Math.floor(tier.fanCount * (0.08 + Math.random() * 0.12));
      const avgFanInvestment= Math.floor((50 + totalPower * 80) * (0.7 + Math.random() * 0.6));
      const totalFanVolume  = investingFans * avgFanInvestment;

      // Hype generated
      const coinHype = Math.floor(totalPower * 8000 * (0.8 + Math.random() * 0.4));

      // Liquidity boost — how many mock "buy" orders get added to history
      const liquidityBump = Math.floor(totalPower * 500 * (0.9 + Math.random() * 0.2));

      // ── APPLY PRICE BOOST ─────────────────────────────────────
      let newPrice = 0;
      let oldPrice = 0;
      try {
        const pc   = await col('stockPrices');
        const pdoc = await pc.findOne({ _id: 'prices' });
        if (pdoc && pdoc[ticker] != null) {
          oldPrice = pdoc[ticker];
          pdoc[ticker] = oldPrice * priceBoost;
          newPrice = pdoc[ticker];
          await pc.replaceOne({ _id:'prices' }, pdoc);
        }
      } catch {}

      // ── ADD FAKE VOLUME TO HISTORY (simulates fan buys) ───────
      try {
        const hc   = await col('stockHistory');
        const hdoc = await hc.findOne({ _id: ticker }) || { _id: ticker, history:[] };
        const now  = Date.now();
        // Inject a spike of buy entries
        const spikeEntries = Array.from({ length: Math.min(20, Math.ceil(totalPower * 3)) }, (_, i) => ({
          t: now - (i * 30000),
          p: oldPrice * (1 + (priceBoost - 1) * ((20 - i) / 20)),
        }));
        hdoc.history = [...(hdoc.history||[]).slice(-80), ...spikeEntries];
        await hc.replaceOne({ _id: ticker }, hdoc, { upsert: true });
      } catch {}

      // ── PAY COIN OWNER REVENUE FROM FAN VOLUME ────────────────
      // 10% of total fan investment volume goes to coin owner as revenue
      let ownerCut = 0;
      if (coin.ownerId) {
        const { getBusiness, saveBusiness } = require('../../utils/bizDb');
        const ownerBiz = getBusiness(coin.ownerId);
        if (ownerBiz) {
          ownerCut = Math.floor(totalFanVolume * 0.10);
          ownerBiz.revenue = (ownerBiz.revenue||0) + ownerCut;
          await saveBusiness(coin.ownerId, ownerBiz);
        }
      }

      // ── PAY INFLUENCER THEIR CUT ──────────────────────────────
      // 5% base, scaling up to 20% at max power
      const influencerPct = Math.min(0.20, 0.05 + (totalPower - 1) * 0.01);
      const influencerCut = Math.floor(totalFanVolume * influencerPct);
      const freshInfluencer = getOrCreateUser(userId);
      freshInfluencer.wallet += influencerCut;
      phone.totalEarned = (phone.totalEarned||0) + influencerCut;
      saveUser(userId, freshInfluencer);

      // Update phone shoutout cooldown
      phone.lastShoutout = { ...(phone.lastShoutout||{}), [ticker]: Date.now() };
      await savePhone(userId, phone);

      // DM coin owner
      if (coin.ownerId && coin.ownerId !== userId) {
        interaction.client.users.fetch(coin.ownerId).then(u => u.send({ embeds:[new EmbedBuilder()
          .setColor(0xf5c518)
          .setTitle('📣 Shoutout — Price Spiking!')
          .setDescription(`**${interaction.user.username}** (${tier.label}) shouted out **${coin.emoji||''} ${coin.name}**!\n\n${fmtNum(investingFans)} fans invested ~$${totalFanVolume.toLocaleString()} in volume.\n\n📈 Price: **$${oldPrice.toFixed(4)} → $${newPrice.toFixed(4)}** (+${Math.round((priceBoost-1)*100)}%)\n🔥 Hype: +${coinHype.toLocaleString()}\n💰 Your cut: +$${ownerCut.toLocaleString()} to business revenue\n📣 Influencer earned: +$${influencerCut.toLocaleString()}`)
        ]}).catch(()=>{})).catch(()=>{});
      }

      const isViral = totalPower >= 5;

      return interaction.editReply({ embeds:[new EmbedBuilder()
        .setColor(isViral ? 0xff3b3b : 0xf5c518)
        .setTitle(`📣 ${isViral ? '🚨 MEGA SHOUTOUT' : 'Shoutout'} — ${coin.emoji||'🪙'} ${coin.name}${isViral ? ' 🚨' : ''}`)
        .setDescription(`${message ? `*"${message}"*\n\n` : ''}**${fmtNum(tier.fanCount)} fans** just heard about **${coin.name}**.${isViral ? '\n\n🚨 **The market is going crazy.**' : ''}`)
        .addFields(
          { name:'📈 Price Spike',      value:`+${Math.round((priceBoost-1)*100)}% (${oldPrice.toFixed(4)} → ${newPrice.toFixed(4)})`, inline:false },
          { name:'👥 Fans Investing',   value:fmtNum(investingFans),                                         inline:true },
          { name:'💸 Fan Volume',       value:`~$${totalFanVolume.toLocaleString()}`,                        inline:true },
          { name:'🔥 Hype Injected',    value:`+${coinHype.toLocaleString()}`,                               inline:true },
          { name:'📊 Liquidity Bump',   value:`+${liquidityBump.toLocaleString()} units`,                   inline:true },
          { name:'💵 Your Cut',         value:`+$${influencerCut.toLocaleString()} (${Math.round(influencerPct*100)}%)`, inline:true },
          ...(ownerCut > 0 ? [{ name:'🏢 Owner Revenue', value:`+$${ownerCut.toLocaleString()}`,             inline:true }] : []),
          { name:'📣 Shoutout Power',   value:`${tier.coinHypeMult}× tier × ${customMult}× custom = **${totalPower.toFixed(1)}×**`, inline:true },
        )
        .setFooter({ text:`${tier.label} · Cooldown: ${config.shoutoutCooldownMins||30}min` })
      ]});
    }

    // ── SPONSORS ─────────────────────────────────────────────
    if (sub === 'sponsors') {
      const phone = getPhone(userId);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No phone. Buy one with `/phone buy`.')], ephemeral:true });

      const tier    = getStatusTier(phone.status || 0);
      const active  = (phone.sponsorDeals||[]).filter(s=>s.active);
      const history = (phone.sponsorDeals||[]).filter(s=>!s.active).slice(-5);

      if (!active.length) {
        const nextSponsorTier = STATUS_TIERS.find(t => t.id !== 'nobody' && t.minStatus > (phone.status||0));
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x5865f2)
          .setTitle('🤝 Sponsor Deals')
          .setDescription(`You have no active sponsor deals.\n\nYour current status (**${tier.label}**) allows **${tier.sponsorSlots} sponsor slot${tier.sponsorSlots!==1?'s':''}**.\n${nextSponsorTier ? `Reach **${nextSponsorTier.label}** (${nextSponsorTier.minStatus.toLocaleString()} status) to unlock better deals.` : ''}`)
          .addFields(history.length ? [{ name:'📜 Recent (collected)', value:history.map(s=>`${s.name} — ${fmtMoney(s.payout)}`).join('\n'), inline:false }] : [])
        ], ephemeral:true });
      }

      // Collect all active
      let total = 0;
      phone.sponsorDeals = (phone.sponsorDeals||[]).map(s => {
        if (s.active) { total += s.payout; return { ...s, active:false, collectedAt:Date.now() }; }
        return s;
      });
      const user = getOrCreateUser(userId);
      user.wallet += total;
      phone.totalEarned = (phone.totalEarned||0) + total;
      saveUser(userId, user);
      await savePhone(userId, phone);

      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
        .setTitle('🤝 Deals Collected!')
        .setDescription(active.map(s=>`${s.name} — **${fmtMoney(s.payout)}**`).join('\n'))
        .addFields(
          { name:'💰 Total',      value:fmtMoney(total),          inline:true },
          { name:'💵 New Wallet', value:fmtMoney(user.wallet),    inline:true },
          { name:'🏆 Status',     value:`${(phone.status||0).toLocaleString()} pts (${tier.label})`, inline:true },
        )
      ]});
    }

    // ── CALL POLICE ──────────────────────────────────────────
    if (sub === 'calpolice') {
      const phone = getPhone(userId);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You need a phone to call police. Buy one with `/phone buy`.')], ephemeral:true });

      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');

      if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't report yourself.")], ephemeral:true });

      const CALL_CD = 30 * 60 * 1000;
      if (phone.callCooldown && Date.now() - phone.callCooldown < CALL_CD) {
        const mins = Math.ceil((CALL_CD-(Date.now()-phone.callCooldown))/60000);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Police call cooldown: **${mins} more minutes**.`)], ephemeral:true });
      }

      phone.callCooldown = Date.now();
      await savePhone(userId, phone);
      await interaction.deferReply();

      const { getPoliceRecord, savePoliceRecord } = require('../../utils/gangDb');
      const store       = getStore();
      const targetUser  = getOrCreateUser(target.id);
      const targetRec   = getPoliceRecord(target.id);
      const drugItems   = (store.items||[]).filter(i => i.isDrug);
      const hasDrugs    = drugItems.some(d => (targetUser.inventory||[]).includes(d.id));
      const heat        = targetRec.heat || 0;
      const convicted   = hasDrugs || heat >= 40 || (targetRec.arrests||0) >= 2;
      const config      = getConfig(interaction.guild.id);

      if (convicted) {
        const jailMins = 5 + Math.floor(Math.random()*10);
        if (config.prisonRoleId && config.prisonChannelId) {
          const { jailUser } = require('../moderation/jail');
          await jailUser(interaction.guild, target.id, jailMins, `Police report: ${reason}`, config, null);
        } else {
          targetRec.jailUntil = Date.now() + jailMins * 60000;
          await savePoliceRecord(target.id, targetRec);
        }
        targetRec.heat = Math.min(100, heat + 15);
        await savePoliceRecord(target.id, targetRec);
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
          .setTitle('🚔 Suspect Arrested!')
          .setDescription(`Police investigated <@${target.id}> and found **evidence**.\n\n**Report:** ${reason}\n**Sentence:** ${jailMins} min\n**Evidence:** ${hasDrugs?'💊 Drugs in possession':heat>=40?'🌡️ High heat level':'📋 Prior arrests'}`)
        ]});
      } else {
        const jailMins = 3 + Math.floor(Math.random()*5);
        if (config.prisonRoleId && config.prisonChannelId) {
          const { jailUser } = require('../moderation/jail');
          await jailUser(interaction.guild, userId, jailMins, 'False police report', config, null);
        }
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setTitle('🚔 False Report!')
          .setDescription(`Police investigated <@${target.id}> and found **nothing**.\n<@${userId}> was arrested for **filing a false report** (${jailMins} min).\n\n⚠️ Think before you call.`)
        ]});
      }
    }
  },
};
