// ============================================================
// commands/economy/tor.js — /tor (Dark Web Marketplace)
// Buy/sell stolen SSNs, credit data, identities
// Traceable unless VPN + hacking buffs or Illuminati
// ============================================================
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser, hasAccount, getUser } = require('../../utils/db');
const { getOrCreateCredit, saveCredit, getCredit, getCreditTier } = require('../../utils/creditDb');
const { getOrCreateTorUser, saveTorUser, getListing, getAllListings, getActiveListings, saveListing, isTraced, calcSsnPrice, TOR_HEAT_ON_BUY, TOR_HEAT_ON_SELL } = require('../../utils/torDb');
const { getLaptop, hasApp } = require('../../utils/laptopDb');
const { isMember: isIllumMember } = require('../../utils/illuminatiDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();
const TOR_COLOR = 0x0a0a0a;
const LISTING_FEE = 500;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tor')
    .setDescription('🌐 Access the dark web marketplace — buy and sell stolen data.')
    .addSubcommand(s => s.setName('connect').setDescription('Connect to TOR and get your anonymous handle'))
    .addSubcommand(s => s.setName('market').setDescription('Browse active data listings on the dark web'))
    .addSubcommand(s => s.setName('sell').setDescription('List stolen data for sale')
      .addUserOption(o => o.setName('victim').setDescription('Whose data you are selling').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Type of data').setRequired(true)
        .addChoices(
          { name:'🪪 Full SSN + Credit Profile', value:'full_ssn'    },
          { name:'💳 Credit Card Data',           value:'card_data'  },
          { name:'🏢 Business Routing Number',    value:'routing'    },
          { name:'📊 Financial Profile',          value:'financial'  },
        ))
      .addIntegerOption(o => o.setName('price').setDescription('Asking price in $').setRequired(true).setMinValue(500)))
    .addSubcommand(s => s.setName('buy').setDescription('Purchase a listing')
      .addStringOption(o => o.setName('listing_id').setDescription('Listing ID from /tor market').setRequired(true)))
    .addSubcommand(s => s.setName('mylistings').setDescription('View your active listings')),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const guildId= interaction.guildId;

    // ── CONNECT ───────────────────────────────────────────────
    if (sub === 'connect') {
      const torUser = await getOrCreateTorUser(userId);
      const laptop  = getLaptop(userId);
      const hasVPN  = hasApp(userId, 'vpn_shield');
      const illum   = isIllumMember(guildId, userId);

      // Need a laptop to access TOR
      const user   = getOrCreateUser(userId);
      const store  = require('../../utils/db').getStore(guildId);
      const device = store.items.find(i =>
        (i.effect?.type === 'laptop' || (i.id||'').toLowerCase().includes('laptop') || (i.name||'').toLowerCase().includes('laptop')) &&
        (user.inventory||[]).includes(i.id)
      );
      if (!device) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('🌐 You need a **laptop** to access TOR.\n\nBuy one from `/shop`.')
      ], ephemeral:true });

      let traceRisk = 30;
      if (hasVPN)  traceRisk -= 18;
      if (illum)   traceRisk = 0;
      const appCount = (laptop?.apps||[]).length;
      traceRisk = Math.max(0, traceRisk - appCount * 2);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(TOR_COLOR)
        .setTitle('🌐 Connected to TOR Network')
        .setDescription('*Welcome to the dark web.*\n\nYou are connected anonymously. Browse, buy, and sell stolen data at your own risk.')
        .addFields(
          { name:'🎭 Your Handle',   value:`\`${torUser.handle}\``,                              inline:true },
          { name:'⭐ Karma',         value:`${torUser.karma||0}`,                                inline:true },
          { name:'📦 Sales/Buys',    value:`${torUser.sales||0} sold · ${torUser.buys||0} bought`, inline:true },
          { name:'🔍 Trace Risk',    value:traceRisk === 0 ? '**0%** — Untraceable' : `**${traceRisk}%**${hasVPN?' (VPN active)':''}`, inline:true },
          { name:'🛡️ VPN',          value:hasVPN ? '✅ Active' : '❌ None — install VPN Shield app', inline:true },
          { name:'🔺 Illuminati',    value:illum ? '✅ Exempt from tracing' : '❌ No exemption',  inline:true },
        )
        .setFooter({ text:'Use /tor market to browse · /tor sell to list data · Getting caught = jail + heat' })
      ], ephemeral:true });
    }

    // ── MARKET ────────────────────────────────────────────────
    if (sub === 'market') {
      const user   = getOrCreateUser(userId);
      const store  = require('../../utils/db').getStore(guildId);
      const device = store.items.find(i =>
        (i.effect?.type === 'laptop' || (i.id||'').toLowerCase().includes('laptop') || (i.name||'').toLowerCase().includes('laptop')) &&
        (user.inventory||[]).includes(i.id)
      );
      if (!device) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Need a laptop to access TOR.')], ephemeral:true });

      const listings = getActiveListings().slice(0, 10);

      if (!listings.length) return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(TOR_COLOR)
        .setTitle('🌐 TOR Market — No Active Listings')
        .setDescription('*The market is quiet...*\n\nBe the first to list stolen data with `/tor sell`.')
      ], ephemeral:true });

      const typeEmoji = { full_ssn:'🪪', card_data:'💳', routing:'🏢', financial:'📊' };
      const lines = listings.map((l,i) => {
        const leakBadge = l.isLeak ? ' 🔓 *data breach*' : '';
        const bizBadge  = l.hasBusinessData ? ' 🏢 *+routing #*' : '';
        return `**${i+1}.** \`${l.id.slice(-6)}\` — ${typeEmoji[l.type]||'📦'} **${l.typeName}**${leakBadge}${bizBadge}\n` +
          `Price: **${fmtMoney(l.price)}** · Seller: \`${l.sellerHandle}\` · Quality: ${'⭐'.repeat(l.quality||1)}\n` +
          `*Expires <t:${Math.floor(l.expiresAt/1000)}:R>*`;
      }).join('\n\n');

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(TOR_COLOR)
        .setTitle(`🌐 TOR Market — ${listings.length} Active Listings (Global)`)
        .setDescription(lines || '*No listings right now.*')
        .setFooter({ text:'Global marketplace — all servers · /tor buy listing_id:<6-char ID> to purchase' })
      ], ephemeral:true });
    }

    // ── SELL ──────────────────────────────────────────────────
    if (sub === 'sell') {
      const victim = interaction.options.getUser('victim');
      const type   = interaction.options.getString('type');
      const price  = interaction.options.getInteger('price');

      // Need a laptop
      const user  = getOrCreateUser(userId);
      const store = require('../../utils/db').getStore(guildId);
      const device = store.items.find(i =>
        (i.effect?.type === 'laptop' || (i.id||'').toLowerCase().includes('laptop') || (i.name||'').toLowerCase().includes('laptop')) &&
        (user.inventory||[]).includes(i.id)
      );
      if (!device) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Need a laptop to access TOR.')], ephemeral:true });

      // Must have the victim's data
      const hackerCredit = await getOrCreateCredit(userId);
      const hasData = hackerCredit.ssnStolen?.[victim.id];
      if (!hasData) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You don't have <@${victim.id}>'s data.\n\nSteal it first with \`/hack ssn\` or \`/laptop run app:ssn_scanner\`.`)
      ], ephemeral:true });

      // Charge listing fee
      if (user.wallet < LISTING_FEE) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Listing fee: **${fmtMoney(LISTING_FEE)}**. You have **${fmtMoney(user.wallet)}**.`)
      ], ephemeral:true });

      user.wallet -= LISTING_FEE;
      saveUser(userId, user);

      const torUser = await getOrCreateTorUser(userId);
      const victimCredit = await getOrCreateCredit(victim.id);
      const typeNames = { full_ssn:'Full SSN + Credit Profile', card_data:'Credit Card Data', routing:'Business Routing', financial:'Financial Profile' };
      const quality = Math.ceil(victimCredit.score / 200); // 1-5 based on credit score
      // Override price with wealth-based dynamic pricing if user didn't set a high enough price
      const dynPrice = calcSsnPrice(victim.id);
      const finalPrice = Math.max(price, Math.floor(dynPrice * 0.5)); // at least 50% of market value

      const listingId = `TOR${Date.now().toString(36).toUpperCase()}`;
      const listing = {
        id: listingId,
        sellerId: userId,
        sellerHandle: torUser.handle,
        victimId: victim.id,
        type,
        typeName: typeNames[type],
        quality,
        price: finalPrice,
        data: {
          ssn:   hasData.ssn,
          score: victimCredit.score,
          card:  victimCredit.card,
          limit: victimCredit.limit,
        },
        createdAt: Date.now(),
        expiresAt: Date.now() + 24*60*60*1000,
        sold: false,
      };

      await saveListing(listingId, listing);
      torUser.sales = (torUser.sales||0) + 1;
      await saveTorUser(userId, torUser);

      // Trace check for seller
      const traced = isTraced(userId, guildId);
      if (traced) {
        const { addHeat } = require('../../utils/gangDb');
        await addHeat(userId, TOR_HEAT_ON_SELL * 2, 'TOR listing traced');

        // Notify victim
        victim.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
          .setTitle('🌐 Dark Web Alert')
          .setDescription('Your data has been listed for sale on the dark web.\n\nFreeze your credit immediately: `/credit freeze`')
        ]}).catch(() => null);

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff8800)
          .setTitle('⚠️ Listed — But Traced!')
          .setDescription(`Listing **${listingId}** is live BUT your connection was traced.\n\n+${TOR_HEAT_ON_SELL*2} heat added. Police are watching.\n\nInstall a **VPN Shield** app on your laptop to reduce trace risk.`)
        ], ephemeral:true });
      }

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(TOR_COLOR)
        .setTitle('🌐 Listing Published')
        .setDescription(`**${typeNames[type]}** listed anonymously.\n\nID: \`${listingId}\`\nPrice: **${fmtMoney(finalPrice)}**${finalPrice > price ? ` *(auto-adjusted to market value)*` : ''}\nQuality: ${'⭐'.repeat(quality)}\nExpires in 24 hours.`)
        .setFooter({ text:'Listing fee deducted. Payment goes to your wallet when sold.' })
      ], ephemeral:true });
    }

    // ── BUY ───────────────────────────────────────────────────
    if (sub === 'buy') {
      const listingId = interaction.options.getString('listing_id').toUpperCase();
      const listing   = getListing(listingId) || getActiveListings().find(l => l.id.slice(-6) === listingId);

      if (!listing) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Listing \`${listingId}\` not found or expired.`)
      ], ephemeral:true });
      if (listing.sold) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('This listing has already been sold.')], ephemeral:true });
      if (listing.sellerId === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't buy your own listing.")], ephemeral:true });

      const user = getOrCreateUser(userId);
      if (user.wallet < listing.price) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Need **${fmtMoney(listing.price)}**. Have **${fmtMoney(user.wallet)}**.`)
      ], ephemeral:true });

      // Pay
      user.wallet -= listing.price;
      saveUser(userId, user);

      // Pay seller
      const sellerUser = getOrCreateUser(listing.sellerId);
      sellerUser.wallet += listing.price;
      saveUser(listing.sellerId, sellerUser);

      // Mark sold
      listing.sold   = true;
      listing.buyerId= userId;
      listing.boughtAt = Date.now();
      await saveListing(listing.id, listing);

      // Give buyer the data
      const buyerCredit = await getOrCreateCredit(userId);
      if (!buyerCredit.ssnStolen) buyerCredit.ssnStolen = {};
      buyerCredit.ssnStolen[listing.victimId] = {
        ssn:     listing.data.ssn,
        partial: false,
        score:   listing.data.score,
        at:      Date.now(),
        source:  'tor_market',
      };
      await saveCredit(userId, buyerCredit);

      // Update buyer karma
      const torBuyer = await getOrCreateTorUser(userId);
      torBuyer.buys = (torBuyer.buys||0) + 1;
      await saveTorUser(userId, torBuyer);

      // Trace check for buyer
      const traced = isTraced(userId, guildId);
      if (traced) {
        const { addHeat } = require('../../utils/gangDb');
        const { getConfig } = require('../../utils/db');
        await addHeat(userId, TOR_HEAT_ON_BUY * 2, 'TOR purchase traced');

        // Notify victim
        require('../../utils/db').getUser; // touch import
        interaction.client.users.fetch(listing.victimId).then(u => u.send({ embeds:[new EmbedBuilder()
          .setColor(0xff3b3b)
          .setTitle('🌐 Dark Web Alert')
          .setDescription('Your data was just purchased on the dark web.')
        ]}).catch(() => null)).catch(() => null);

        // Check if should jail
        const jailConfig = getConfig(guildId);
        if (jailConfig.prisonRoleId && jailConfig.prisonChannelId) {
          const member = await interaction.guild.members.fetch(userId).catch(() => null);
          if (member) {
            await member.roles.add(jailConfig.prisonRoleId).catch(() => null);
            const jailTime = 10 * 60 * 1000; // 10 min
            setTimeout(async () => {
              member.roles.remove(jailConfig.prisonRoleId).catch(() => null);
            }, jailTime);
            const jailChan = await interaction.client.channels.fetch(jailConfig.prisonChannelId).catch(() => null);
            if (jailChan) await jailChan.send(`🚨 <@${userId}> was caught buying stolen data on the dark web and has been jailed for 10 minutes.`);
          }
        }

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
          .setTitle('🚨 TRACED AND JAILED!')
          .setDescription(`You purchased the data but your connection was traced!\n\n+${TOR_HEAT_ON_BUY*2} heat · Jailed 10 minutes.\n\n**Install a VPN Shield app** to reduce trace risk next time.\n*Illuminati members are always exempt from tracing.*`)
        ], ephemeral:true });
      }

      const typeEmoji = { full_ssn:'🪪', card_data:'💳', routing:'🏢', financial:'📊', full_identity:'🪪🏢' };
      const dataLines = [
        `🪪 SSN: \`${listing.data.ssn}\``,
        `📊 Score: **${listing.data.score}** (${getCreditTier(listing.data.score).label})`,
        ...(listing.data.routingNumber ? [`🏢 Business Routing: \`${listing.data.routingNumber}\`` + (listing.data.bizName ? ` (${listing.data.bizName})` : '')] : []),
        ...(listing.data.card ? [`💳 Card: \`${listing.data.card}\``] : []),
      ].join('\n');
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(TOR_COLOR)
        .setTitle(`${typeEmoji[listing.type]||'📦'} Purchase Complete`)
        .setDescription(`**${listing.typeName}** acquired anonymously.\n\n${dataLines}\n\nData stored. Use \`/laptop run\` or \`/hack\` to exploit it.`)
      ], ephemeral:true });
    }

    // ── MY LISTINGS ───────────────────────────────────────────
    if (sub === 'mylistings') {
      const mine = Object.values(getAllListings()).filter(l => l.sellerId === userId);
      if (!mine.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(TOR_COLOR).setDescription('No active listings.')], ephemeral:true });
      const lines = mine.map(l =>
        `\`${l.id.slice(-6)}\` ${l.sold?'✅ SOLD':'⏳ Active'} — **${fmtMoney(l.price)}** · ${l.typeName}`
      ).join('\n');
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(TOR_COLOR).setTitle('🌐 My TOR Listings').setDescription(lines)], ephemeral:true });
    }
  },
};
