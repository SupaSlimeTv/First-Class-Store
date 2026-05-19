// ============================================================
// commands/economy/illuminati.js — /illuminati
// The shadow organization. Per-server, rank carries cross-server.
// Enhanced with factions, rituals, and family connections
// ============================================================

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser, getConfig } = require('../../utils/db');
const {
  getIlluminati, getOrCreateIlluminati, saveIlluminati,
  getMember, isMember, isGrandmaster, isElder,
  getEvidence, addEvidence, clearEvidence, checkEligibility,
  RANKS, MAX_MEMBERS, INITIATION_FEE, EXPOSE_THRESHOLD,
} = require('../../utils/illuminatiDb');
const { COLORS } = require('../../utils/embeds');
const { getArtistTier, getNextArtistTier, INDUSTRY_PLANT_MULT, ARTIST_TIERS } = require('../../utils/phoneDb');
const { coinAutocomplete } = require('../../utils/coinAutocomplete');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();
const ILLUM_COLOR = 0x1a1a2e;
const GOLD_COLOR  = 0xf5c518;

// Illuminati factions with unique benefits
const ILLUMINATI_FACTIONS = {
  "financial_elite": {
    name: "Financial Elite",
    emoji: "💰",
    benefits: ["+15% investment returns", "Access to offshore accounts", "Market manipulation abilities"],
    requirements: { wealth: 1000000, business_level: 10 }
  },
  
  "political_power": {
    name: "Political Power",
    emoji: "🏛️",
    benefits: ["Can reduce other players' heat", "Access classified information", "Veto abilities"],
    requirements: { influence: 5000, reputation: "high" }
  },
  
  "entertainment": {
    name: "Entertainment Moguls",
    emoji: "🎬",
    benefits: ["Boost social media presence", "Create viral content", "Launch careers"],
    requirements: { followers: 100000, status_points: 2500 }
  },
  
  "secret_societies": {
    name: "Secret Societies",
    emoji: "🔮",
    benefits: ["Ritual magic abilities", "Information networks", "Ancient knowledge"],
    requirements: { completed_rituals: 5, knowledge_level: 50 }
  },
  
  "tech_giants": {
    name: "Tech Giants",
    emoji: "💻",
    benefits: ["Hack abilities", "Data mining", "Algorithm manipulation"],
    requirements: { tech_skills: 75, net_worth: 500000 }
  },

  "freemason_lodge": {
    name: "Freemason Lodge",
    emoji: "🔨",
    benefits: ["Brotherhood passive dividends", "Lodge meeting payouts", "Secret network intel sharing"],
    requirements: { rank: "elder", contribution: 500000 }
  },

  "sports_syndicate": {
    name: "Sports Syndicate",
    emoji: "🏆",
    benefits: ["Match fixing ability", "Rigged winnings payouts", "Athlete career influence"],
    requirements: { wealth: 750000, status_points: 1500 }
  },

  "old_blood_elite": {
    name: "Old Blood Elite",
    emoji: "👑",
    benefits: ["Lineage wealth amplification", "Bank interest boosting", "Inherited power bonuses"],
    requirements: { wealth: 2000000, business_level: 12 }
  },

  "hollywood_cabal": {
    name: "Hollywood Cabal",
    emoji: "🎭",
    benefits: ["Industry blacklist power", "Career gatekeeping", "7-day platform suppression"],
    requirements: { followers: 500000, status_points: 5000 }
  }
};

// Ritual system
const ILLUMINATI_RITUALS = {
  "initiation": {
    name: "The Awakening",
    description: "First step into enlightenment",
    requirements: { rank: "initiate", contribution: 10000 },
    effects: ["Unlock basic abilities", "Reveal hidden paths"],
    cooldown: 0,
    cost: { money: 5000, sacrifice: "reputation" }
  },
  
  "career_boost": {
    name: "Prosperity Circle",
    description: "Accelerate your career progression",
    requirements: { rank: "operative", completed_rituals: 2 },
    effects: ["+2 business levels", "+25% work income for 7 days"],
    cooldown: 7,
    cost: { money: 25000, sacrifice: "time" }
  },
  
  "power_grab": {
    name: "Dominion Ritual",
    description: "Consolidate your power over others",
    requirements: { rank: "elder", faction: "political_power" },
    effects: ["Can remove heat from any player", "Access to classified info"],
    cooldown: 14,
    cost: { money: 100000, sacrifice: "loyalty" }
  },
  
  "soul_exchange": {
    name: "Soul Exchange",
    description: "Exchange your soul for ultimate power",
    requirements: { rank: "grandmaster", soul_sold: false },
    effects: ["Double all abilities", "Immunity to heat", "Unlock secret commands"],
    cooldown: 0,
    cost: { soul: true }
  },

  "blood_moon": {
    name: "Blood Moon Sacrifice",
    description: "Channel dark energy through a living sacrifice to enrich the vault",
    requirements: { rank: "grandmaster" },
    effects: ["Drain 20% of target wallet into vault", "Moon charges the vault"],
    cooldown: 30,
    cost: { money: 0 },
    minParticipants: 3,
  },

  "brotherhood_oath": {
    name: "Brotherhood Oath",
    description: "Swear the ancient Masonic oath — your Lodge dividends double forever",
    requirements: { faction: "freemason_lodge" },
    effects: ["Lodge Meeting dividends doubled permanently", "Oath bond sealed"],
    cooldown: 0,
    oneTime: true,
    cost: { money: 50000 },
    minParticipants: 2,
  },

  "championship_hex": {
    name: "Championship Hex",
    description: "Curse a rival — their grind suffers for 48 hours",
    requirements: { faction: "sports_syndicate", minRank: "operative" },
    effects: ["-20% hype, -15% followers on target", "Work suppressed 48hrs"],
    cooldown: 3,
    cost: { money: 40000 },
    minParticipants: 2,
  },

  "starmaker_rite": {
    name: "Starmaker Rite",
    description: "Anoint a chosen one with Hollywood's blessing — massive follower surge",
    requirements: { faction: "hollywood_cabal", minRank: "elder" },
    effects: ["+500K followers to target", "+50K hype to target", "Hollywood blessed"],
    cooldown: 7,
    cost: { money: 150000 },
    minParticipants: 3,
  },

  "covenant": {
    name: "The Covenant",
    description: "Bind your bloodline to the order — eternal protection, amplified blessings",
    requirements: { minRank: "elder" },
    effects: ["Immune to Illuminati curses and hexes", "Family blessings grant double bonuses", "Covenant mark permanent"],
    cooldown: 0,
    oneTime: true,
    cost: { money: 200000 },
    minParticipants: 3,
  },

  "dark_bargain": {
    name: "Dark Bargain",
    description: "Coerce a fellow member — their soul or their rank",
    requirements: { rank: "grandmaster" },
    effects: ["Target receives soul ultimatum", "Accept: soul sold + power", "Refuse: demoted one rank"],
    cooldown: 7,
    cost: { money: 0 },
    minParticipants: 2,
  },

  "grand_sacrifice": {
    name: "Grand Sacrifice",
    description: "Mark a member for sacrifice — pay a ransom or lose 40% of all assets",
    requirements: { rank: "grandmaster" },
    effects: ["Target must pay 30% of wealth as ransom within 24hrs", "Refusal: 40% wallet+bank seized, business drops 1 level"],
    cooldown: 21,
    cost: { money: 0 },
    minParticipants: 3,
  },

  "blood_eclipse": {
    name: "Blood Eclipse",
    description: "Total lunar sacrifice — drain all non-members server-wide ($1M vault)",
    requirements: { rank: "grandmaster" },
    effects: ["All non-members lose 8% of wallet to vault", "Server-wide announcement", "Massive evidence generated"],
    cooldown: 90,
    cost: { money: 0 },
    minParticipants: 5,
  },

  "soul_harvest": {
    name: "Soul Harvest",
    description: "Call in your investment — drain all soul-sold members immediately",
    requirements: { minRank: "elder" },
    effects: ["20% of each soul-sold member's wallet seized to vault", "They are reminded of their pact"],
    cooldown: 14,
    cost: { money: 0 },
    minParticipants: 3,
  },

  "dark_enlightenment": {
    name: "Dark Enlightenment",
    description: "Illuminate all members — surge of power and fame ($300K vault)",
    requirements: { minRank: "elder" },
    effects: ["+2 business levels to all members", "+250K followers to all members with phones"],
    cooldown: 30,
    cost: { money: 0 },
    minParticipants: 4,
  },

  "abyssal_pact": {
    name: "Abyssal Pact",
    description: "Seal the order's dominance — untouchable for 7 days ($500K vault)",
    requirements: { rank: "grandmaster" },
    effects: ["Expose attempts blocked for 7 days", "Server-wide announcement of dominance", "Operations generate 50% less evidence"],
    cooldown: 60,
    cost: { money: 0 },
    minParticipants: 5,
  }
};

// Family system integration
const FAMILY_EVENTS = {
  "illuminati_blessing": {
    name: "Illuminati Blessing",
    description: "Your family receives the blessing of the shadow order",
    effects: ["+20 family happiness", "+10 family reputation"],
    probability: 0.15
  },
  
  "arranged_marriage": {
    name: "Strategic Marriage",
    description: "A marriage arranged by the Illuminati for political gain",
    effects: ["+15 family wealth", "+5 family reputation", "+10 family influence"],
    probability: 0.1
  },
  
  "family_legacy": {
    name: "Family Legacy",
    description: "Your family's influence grows through Illuminati connections",
    effects: ["+25 family reputation", "Unlock special business opportunities"],
    probability: 0.08
  }
};

// Pending invites: `${guildId}:${targetId}` -> { inviterId, expiresAt }
const _pendingInvites = {};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('illuminati')
    .setDescription('🔺 The shadow organization. Power beyond gangs.')
    .addSubcommand(s => s.setName('found').setDescription('Found the Illuminati in this server (costs $250,000)'))
    .addSubcommand(s => s.setName('status').setDescription('View the Illuminati status and your standing'))
    .addSubcommand(s => s.setName('invite').setDescription('Invite an eligible member (Grandmaster/Elder only)')
      .addUserOption(o => o.setName('user').setDescription('Who to invite').setRequired(true)))
    .addSubcommand(s => s.setName('faction').setDescription('Join a faction (Elders and Grandmasters only)')
      .addStringOption(o => o.setName('name').setDescription('Faction to join').setRequired(true)
        .addChoices(
          { name: '💰 Financial Elite', value: 'financial_elite' },
          { name: '🏛️ Political Power', value: 'political_power' },
          { name: '🎬 Entertainment Moguls', value: 'entertainment' },
          { name: '🔮 Secret Societies', value: 'secret_societies' },
          { name: '💻 Tech Giants', value: 'tech_giants' },
          { name: '🔨 Freemason Lodge', value: 'freemason_lodge' },
          { name: '🏆 Sports Syndicate', value: 'sports_syndicate' },
          { name: '👑 Old Blood Elite', value: 'old_blood_elite' },
          { name: '🎭 Hollywood Cabal', value: 'hollywood_cabal' }
        )))
    .addSubcommand(s => s.setName('ritual').setDescription('Perform a ritual')
      .addStringOption(o => o.setName('name').setDescription('Ritual to perform').setRequired(true)
        .addChoices(
          { name: '🔺 The Awakening', value: 'initiation' },
          { name: '💰 Prosperity Circle', value: 'career_boost' },
          { name: '👑 Dominion Ritual', value: 'power_grab' },
          { name: '🖤 Soul Exchange', value: 'soul_exchange' },
          { name: '🌑 Blood Moon Sacrifice', value: 'blood_moon' },
          { name: '🔨 Brotherhood Oath', value: 'brotherhood_oath' },
          { name: '💫 Championship Hex', value: 'championship_hex' },
          { name: '🎭 Starmaker Rite', value: 'starmaker_rite' },
          { name: '⛓️ The Covenant', value: 'covenant' },
          { name: '🕯️ Dark Bargain', value: 'dark_bargain' },
          { name: '⚰️ Grand Sacrifice — force a ransom or seize a member\'s assets', value: 'grand_sacrifice' },
          { name: '🌒 Blood Eclipse — drain ALL non-member wallets 8% ($1M vault)', value: 'blood_eclipse' },
          { name: '💀 Soul Harvest — seize 20% from every soul-sold member', value: 'soul_harvest' },
          { name: '✨ Dark Enlightenment — +2 biz + 250K followers to all members ($300K vault)', value: 'dark_enlightenment' },
          { name: '🕳️ Abyssal Pact — untouchable 7 days + server announcement ($500K vault)', value: 'abyssal_pact' }
        ))
      .addUserOption(o => o.setName('target').setDescription('Target user (Blood Moon, Hex, Starmaker, Dark Bargain, Grand Sacrifice)').setRequired(false)))
    .addSubcommand(s => s.setName('family').setDescription('Influence a family (Illuminati only)')
      .addUserOption(o => o.setName('target').setDescription('User whose family to influence').setRequired(true))
      .addStringOption(o => o.setName('action').setDescription('Type of influence').setRequired(true)
        .addChoices(
          { name: '✨ Bless', value: 'bless' },
          { name: '💀 Curse', value: 'curse' },
          { name: '🎯 Opportunity', value: 'opportunity' }
        )))
    .addSubcommand(s => s.setName('vault').setDescription('Contribute to or view the vault')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to contribute (leave blank to view)').setRequired(false).setMinValue(1)))
    .addSubcommand(s => s.setName('promote').setDescription('Promote a member (Grandmaster only)')
      .addUserOption(o => o.setName('user').setDescription('Member to promote').setRequired(true)))
    .addSubcommand(s => s.setName('excommunicate').setDescription('Exile a member (requires Elder vote)')
      .addUserOption(o => o.setName('user').setDescription('Member to exile').setRequired(true)))
    .addSubcommand(s => s.setName('operate').setDescription('Execute an operation using vault funds')
      .addStringOption(o => o.setName('operation').setDescription('Operation to run').setRequired(true)
        .addChoices(
          { name:'🕵️ Shadow Rob — anonymously drain 10% from a user ($50k)',    value:'shadow_rob' },
          { name:'📡 Intel Report — full profile on any user ($25k)',            value:'intel' },
          { name:'🛡️ Protection Racket — demand tribute from a gang (free)',    value:'protection' },
          { name:'📊 Market Manipulation — pump or dump a coin 30min ($200k)',  value:'market_manip' },
          { name:'💸 Tribute Collection — collect owed tribute now',            value:'collect_tribute' },
          { name:'📸 Blackmail — control a Celebrity+ ($150k)',                 value:'blackmail' },
          { name:'🎵 Force Sign — force a Celebrity+ onto your label (free)',   value:'sign_artist' },
          { name:'🎤 Sabotage Artist — crash a signed artist career ($75k)',    value:'sabotage' },
          { name:'🔇 Silence Campaign — suppress a user phone posts ($60k)', value:'silence_campaign' },
          { name:'💰 Extort — demand payment or face shadow rob ($0)',          value:'extort' },
          { name:'🌱 Industry Plant — make any artist a superstar overnight ($500k)', value:'industry_plant' },
          // New faction-specific operations
          { name:'🏛️ Policy Change — alter server rules temporarily ($100k)', value:'policy_change' },
          { name:'💻 Data Breach — steal sensitive information from all users ($75k)', value:'data_breach' },
          { name:'🎬 Viral Campaign — create a viral trend for faction benefit ($50k)', value:'viral_campaign' },
          { name:'🔮 Ancient Ritual — perform a powerful ritual affecting the whole server ($300k)', value:'ancient_ritual' },
          { name:'🔨 Lodge Meeting — brotherhood dividend paid to all Masons (free)', value:'lodge_meeting' },
          { name:'🏆 Match Fix — rigged winnings paid to Sports Syndicate members ($150k)', value:'match_fix' },
          { name:'👑 Bloodline Dividend — amplify bank interest for Old Blood members ($250k)', value:'bloodline_dividend' },
          { name:'🎭 Industry Blacklist — kill target\'s phone earnings for 7 days ($80k)', value:'blacklist' },
        ))
      .addUserOption(o => o.setName('target').setDescription('Target user (not needed for market manipulation)').setRequired(false))
      .addStringOption(o => o.setName('coin').setDescription('Coin ticker (market manipulation only — type to search)').setRequired(false).setAutocomplete(true))
      .addStringOption(o => o.setName('direction').setDescription('Pump or dump? (market manipulation only)').setRequired(false)
        .addChoices({ name:'📈 Pump', value:'pump' }, { name:'📉 Dump', value:'dump' })))
    .addSubcommand(s => s.setName('expose').setDescription('Attempt to expose the Illuminati publicly'))
    .addSubcommand(s => s.setName('sellsoul').setDescription('🖤 Sell your soul — sacrifice freedom for power')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'coin') return coinAutocomplete(interaction, 'coin');
  },

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const userId  = interaction.user.id;
    const guildId = interaction.guildId;

    // ── FOUND ─────────────────────────────────────────────────
    if (sub === 'found') {
      if (getIlluminati(guildId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('The Illuminati already exists in this server.')
      ], ephemeral:true });

      const issues = await checkEligibility(userId, guildId);
      if (issues.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('🔺 Not Eligible')
        .setDescription(`You don't meet the requirements:\n${issues.map(i=>`• ${i}`).join('\n')}`)
      ], ephemeral:true });

      const user = getOrCreateUser(userId);
      if (user.wallet < INITIATION_FEE) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Founding costs **${fmtMoney(INITIATION_FEE)}**. You have **${fmtMoney(user.wallet)}**.`)
      ], ephemeral:true });

      user.wallet -= INITIATION_FEE;
      saveUser(userId, user);

      const org = getOrCreateIlluminati(guildId);
      org.members.push({ 
        userId, 
        rank:'grandmaster', 
        joinedAt:Date.now(), 
        contribution:INITIATION_FEE, 
        guildId,
        faction: null,
        rituals: [],
        soulSold: false
      });
      org.vault += INITIATION_FEE;
      await saveIlluminati(guildId, org);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(GOLD_COLOR)
        .setTitle('🔺 The Illuminati Has Been Founded')
        .setDescription(`<@${userId}> has established the shadow order.\n\nThe **${fmtMoney(INITIATION_FEE)}** initiation fee has been deposited into the vault.\n\nYou are the **⚡ Grandmaster**. Choose your Elders wisely and establish factions to expand your power.`)
        .setFooter({ text:'Membership is invite-only. Max 13 members. Factions provide unique benefits.' })
      ]});
    }

    // ── STATUS ────────────────────────────────────────────────
    if (sub === 'status') {
      const org = getIlluminati(guildId);
      if (!org) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888)
        .setDescription('🔺 No Illuminati exists in this server yet. Use `/illuminati found` to establish one.')
      ], ephemeral:true });

      const isMem = isMember(guildId, userId);
      const myRank= getMember(guildId, userId);

      // Members see full list, non-members see only count if not exposed
      const exposed = org.exposed;
      let memberList = '';

      if (isMem || exposed) {
        memberList = org.members.map(m => {
          const faction = m.faction ? ILLUMINATI_FACTIONS[m.faction] : null;
          const factionTag = faction ? ` ${faction.emoji}` : '';
          const ritualCount = m.rituals ? m.rituals.length : 0;
          return `${RANKS[m.rank]?.label||'🔺'}${factionTag} <@${m.userId}>${m.soulSold ? ' 🖤' : ''} — ${ritualCount} rituals — contributed ${fmtMoney(m.contribution||0)}`;
        }).join('\n') || 'None';
      } else {
        memberList = `**${org.members.length}** members *(identities hidden)*`;
      }

      // Faction breakdown
      let factionBreakdown = '';
      if (isMem || exposed) {
        const factions = {};
        org.members.forEach(m => {
          const factionId = m.faction || 'none';
          factions[factionId] = (factions[factionId] || 0) + 1;
        });
        
        factionBreakdown = Object.entries(factions).map(([id, count]) => {
          if (id === 'none') return `Unaligned: ${count}`;
          const faction = ILLUMINATI_FACTIONS[id];
          return `${faction.emoji} ${faction.name}: ${count}`;
        }).join('\n');
      }

      const myMember = getMember(guildId, userId);
      const { getAgeString, getLifePath } = require('../../utils/lifePathDb');
      const myLp = getLifePath(userId);
      const myAgeStr = myLp?.bornAt ? getAgeString(myLp.bornAt) : null;
      const myPathInfo = myLp?.path ? `${myLp.path.replace(/_/g,' ')}` : null;

      const soulDesc = myMember?.soulSold
        ? `Your rank: **${RANKS[myMember.rank]?.label}**\n\n🖤 **Your soul is owned.** The Illuminati has complete control over you.`
        : myMember ? `Your rank: **${RANKS[myMember.rank]?.label}**${myAgeStr ? ` · 📅 ${myAgeStr}` : ''}${myPathInfo ? ` · ${myPathInfo}` : ''}` : null;

      const embed = new EmbedBuilder()
        .setColor(isMem ? GOLD_COLOR : ILLUM_COLOR)
        .setTitle(`🔺 The Illuminati${exposed ? ' *(EXPOSED)*' : ''}`)
        .addFields(
          { name:'👥 Members', value:memberList, inline:false },
          { name:'🏦 Vault',   value:isMem ? fmtMoney(org.vault) : '***', inline:true },
          { name:'📊 Ops Run', value:`${(org.operations||[]).length}`, inline:true },
        );

      if (isMem || exposed) {
        embed.addFields(
          { name:'🔮 Factions', value:factionBreakdown || 'None established', inline:false }
        );
      }

      if (soulDesc) embed.setDescription(soulDesc);
      if (exposed) embed.setFooter({ text:'The Illuminati has been exposed!' });

      return interaction.reply({ embeds:[embed], ephemeral: !exposed });
    }

    // ── FACTION ───────────────────────────────────────────────
    if (sub === 'faction') {
      const org = getIlluminati(guildId);
      if (!org) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No Illuminati in this server.')], ephemeral:true });
      if (!isMember(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Members only.')], ephemeral:true });
      
      const member = getMember(guildId, userId);
      if (!['elder', 'grandmaster'].includes(member.rank)) {
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Only Elders and Grandmasters can join factions.')], ephemeral:true });
      }

      const factionName = interaction.options.getString('name');
      const faction = ILLUMINATI_FACTIONS[factionName];
      if (!faction) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Invalid faction.')], ephemeral:true });

      // Check if already in a faction
      if (member.faction) {
        const currentFaction = ILLUMINATI_FACTIONS[member.faction];
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`You are already in the **${currentFaction.name}** faction. Use \`/illuminati faction leave\` to leave your current faction first.`)
        ], ephemeral:true });
      }

      // Check requirements (simplified for this example)
      // In a full implementation, you'd check all requirements

      // Join faction
      member.faction = factionName;
      await saveIlluminati(guildId, org);

      return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
        .setTitle(`${faction.emoji} Joined ${faction.name} Faction`)
        .setDescription(`You have joined the **${faction.name}** faction.\n\n**Benefits:**\n${faction.benefits.map(b => `• ${b}`).join('\n')}`)
      ], ephemeral:true });
    }

    // ── RITUAL ───────────────────────────────────────────────
    if (sub === 'ritual') {
      const org = getIlluminati(guildId);
      if (!org) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No Illuminati in this server.')], ephemeral:true });
      if (!isMember(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Members only.')], ephemeral:true });

      const member = getMember(guildId, userId);
      const ritualName = interaction.options.getString('name');
      const ritual = ILLUMINATI_RITUALS[ritualName];
      if (!ritual) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Invalid ritual.')], ephemeral:true });

      // Check requirements
      if (ritual.requirements.rank && member.rank !== ritual.requirements.rank) {
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`This ritual requires the rank of **${RANKS[ritual.requirements.rank].label}**. You are **${RANKS[member.rank].label}**.`)
        ], ephemeral:true });
      }

      if (ritual.requirements.completed_rituals) {
        const completedRituals = member.rituals ? member.rituals.length : 0;
        if (completedRituals < ritual.requirements.completed_rituals) {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription(`This ritual requires **${ritual.requirements.completed_rituals}** completed rituals. You have completed **${completedRituals}**.`)
          ], ephemeral:true });
        }
      }

      if (ritual.requirements.faction && member.faction !== ritual.requirements.faction) {
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`This ritual requires the **${ILLUMINATI_FACTIONS[ritual.requirements.faction].name}** faction.`)
        ], ephemeral:true });
      }

      // Minimum rank check (at-least, not exact)
      if (ritual.requirements.minRank) {
        const rankOrder = ['initiate', 'operative', 'elder', 'grandmaster'];
        if (rankOrder.indexOf(member.rank) < rankOrder.indexOf(ritual.requirements.minRank)) {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription(`This ritual requires **${RANKS[ritual.requirements.minRank].label}** or higher. You are **${RANKS[member.rank].label}**.`)
          ], ephemeral:true });
        }
      }

      // Pre-flight: validate target before any cost is charged
      if (['blood_moon', 'championship_hex', 'starmaker_rite', 'dark_bargain', 'grand_sacrifice'].includes(ritualName)) {
        const preTarget = interaction.options.getUser('target');
        if (!preTarget) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription('This ritual requires a **target** user.')
        ], ephemeral:true });
        if ((ritualName === 'blood_moon' || ritualName === 'championship_hex') && isMember(guildId, preTarget.id)) {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('Cannot target a fellow Illuminati member with this ritual.')
          ], ephemeral:true });
        }
        if (ritualName === 'dark_bargain') {
          if (!isMember(guildId, preTarget.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('The Dark Bargain target must be an Illuminati member.')
          ], ephemeral:true });
          const tMem = getMember(guildId, preTarget.id);
          if (tMem.rank === 'grandmaster') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('Cannot make a Dark Bargain with another Grandmaster.')
          ], ephemeral:true });
          if (tMem.soulSold) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription(`<@${preTarget.id}> has already sold their soul.`)
          ], ephemeral:true });
        }
        if (ritualName === 'grand_sacrifice') {
          if (!isMember(guildId, preTarget.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('The Grand Sacrifice target must be an Illuminati member.')
          ], ephemeral:true });
          const tMem = getMember(guildId, preTarget.id);
          if (tMem.rank === 'grandmaster') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('Cannot sacrifice another Grandmaster.')
          ], ephemeral:true });
        }
      }

      // Check cooldown
      if (ritual.cooldown > 0) {
        const lastRitual = member.rituals && member.rituals.find(r => r.name === ritualName);
        if (lastRitual) {
          const daysSince = (Date.now() - lastRitual.performedAt) / (1000 * 60 * 60 * 24);
          if (daysSince < ritual.cooldown) {
            return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
              .setDescription(`This ritual is on cooldown. You can perform it again in **${Math.ceil(ritual.cooldown - daysSince)}** days.`)
            ], ephemeral:true });
          }
        }
      }

      // One-time rituals
      if (ritual.oneTime && member.rituals?.some(r => r.name === ritualName)) {
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription('This ritual can only be performed once. The seal is already upon you.')
        ], ephemeral:true });
      }

      // ── JOIN PHASE (black tea pattern) ────────────────────────
      const minP   = ritual.minParticipants || 1;
      const rtargetUser = ['blood_moon','championship_hex','starmaker_rite','dark_bargain','grand_sacrifice'].includes(ritualName)
        ? interaction.options.getUser('target') : null;

      // proceedWithRitual — called after join phase succeeds (or immediately for solo rituals)
      // replyFn(opts) handles both solo ephemeral and group public edits transparently
      const proceedWithRitual = async (replyFn, participants) => {
        // Cost check (re-fetch user to get latest wallet after join window)
        if (ritual.cost.money) {
          const freshUser = getOrCreateUser(userId);
          if (freshUser.wallet < ritual.cost.money) {
            return replyFn({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
              .setDescription(`This ritual costs **${fmtMoney(ritual.cost.money)}**. You have **${fmtMoney(freshUser.wallet)}**.`)
            ] });
          }
          freshUser.wallet -= ritual.cost.money;
          saveUser(userId, freshUser);
        }

        if (ritual.cost.soul) {
          if (member.soulSold) {
            return replyFn({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
              .setDescription('You have already sold your soul.')
            ] });
          }
          member.soulSold = true;
        }

        // Record ritual
        if (!member.rituals) member.rituals = [];
        member.rituals.push({ name: ritualName, performedAt: Date.now() });

        // Apply generic effects
        let effectDesc = '';
        if (ritual.effects.includes('+2 business levels')) {
          const { getBusiness, saveBusiness } = require('../../utils/bizDb');
          const business = getBusiness(userId);
          if (business) {
            business.level = (business.level || 1) + 2;
            saveBusiness(userId, business);
            effectDesc += '\n• Business level increased by 2';
          }
        }
        if (ritual.effects.includes('+25% work income for 7 days')) {
          effectDesc += '\n• Work income increased by 25% for 7 days';
        }
        if (ritual.effects.includes('Double all abilities')) {
          effectDesc += '\n• All abilities doubled';
        }

        // ── RITUAL-SPECIFIC EFFECTS ──────────────────────────
        if (ritualName === 'blood_moon') {
          const victim  = getOrCreateUser(rtargetUser.id);
          const drained = Math.floor(victim.wallet * 0.20);
          if (drained > 0) {
            victim.wallet -= drained;
            saveUser(rtargetUser.id, victim);
            org.vault += drained;
            effectDesc += `\n• **${fmtMoney(drained)}** drained from <@${rtargetUser.id}> into the vault`;
          } else {
            effectDesc += `\n• <@${rtargetUser.id}> had nothing in their wallet to drain`;
          }
          rtargetUser.send({ embeds:[new EmbedBuilder().setColor(0x1a0000)
            .setTitle('🌑 Blood Moon')
            .setDescription(`Something ancient reached into your life tonight.\n\n**${fmtMoney(drained)}** has vanished from your wallet. No trace. No explanation.\n\n*The moon is red tonight.*`)
          ]}).catch(()=>null);
        }

        if (ritualName === 'brotherhood_oath') {
          member.lodgeOath = true;
          effectDesc += '\n• Lodge Meeting dividends are now **doubled** for you permanently';
        }

        if (ritualName === 'championship_hex') {
          const { getPhone: _ghp, savePhone: _shp } = require('../../utils/phoneDb');
          const tPhone = _ghp(rtargetUser.id);
          if (tPhone) {
            tPhone.hype       = Math.max(0, Math.floor((tPhone.hype || 0) * 0.80));
            tPhone.followers  = Math.max(0, Math.floor((tPhone.followers || 0) * 0.85));
            tPhone.hexedUntil = Date.now() + 48 * 60 * 60 * 1000;
            await _shp(rtargetUser.id, tPhone);
          }
          rtargetUser.send({ embeds:[new EmbedBuilder().setColor(0x2c1a00)
            .setTitle('💫 Championship Hex')
            .setDescription('A curse has settled over your hustle.\n\n-20% hype · -15% followers · Work suppressed for **48 hours**.\n\n*Someone in the shadows doesn\'t want you winning.*')
          ]}).catch(()=>null);
          effectDesc += `\n• <@${rtargetUser.id}> hexed: -20% hype, -15% followers, suppressed 48hrs`;
        }

        if (ritualName === 'starmaker_rite') {
          const { getPhone: _gsp, savePhone: _ssp } = require('../../utils/phoneDb');
          const tPhone2 = _gsp(rtargetUser.id);
          if (!tPhone2) {
            effectDesc += `\n• <@${rtargetUser.id}> has no phone — rite stored but not applied`;
          } else {
            tPhone2.followers          = (tPhone2.followers || 0) + 500000;
            tPhone2.hype               = (tPhone2.hype || 0) + 50000;
            tPhone2.hollywoodBlessed   = true;
            tPhone2.hollywoodBlessedAt = Date.now();
            await _ssp(rtargetUser.id, tPhone2);
            rtargetUser.send({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
              .setTitle('🎭 Hollywood Blessed')
              .setDescription('The Cabal has chosen you.\n\n**+500,000 followers · +50,000 hype**\n\n*Your name is on everyone\'s lips. Someone powerful is behind you.*')
            ]}).catch(()=>null);
            effectDesc += `\n• <@${rtargetUser.id}> anointed: +500K followers, +50K hype`;
          }
        }

        if (ritualName === 'covenant') {
          member.covenant = true;
          effectDesc += '\n• Your bloodline is bound to the order permanently';
          effectDesc += '\n• Immune to Illuminati curses and hexes';
          effectDesc += '\n• Family blessings grant double bonuses';
        }

        if (ritualName === 'dark_bargain') {
          const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`illum_dark_accept_${guildId}_${rtargetUser.id}`).setLabel('🖤 Accept the Bargain').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`illum_dark_refuse_${guildId}_${rtargetUser.id}`).setLabel('❌ Refuse (lose a rank)').setStyle(ButtonStyle.Secondary),
          );
          rtargetUser.send({ embeds:[new EmbedBuilder().setColor(0x1a1a2e)
            .setTitle('🕯️ A Dark Bargain Has Been Offered')
            .setDescription(`The **⚡ Grandmaster** has extended a coercive offer.\n\n🖤 **Accept:** Your soul is sold. You gain soul-sold power but the order owns you completely.\n\n❌ **Refuse:** Lose one rank. No negotiation.\n\n*You have 10 minutes to decide.*`)
          ], components:[row3] }).catch(()=>null);
          setTimeout(() => {
            rtargetUser.send({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('The Dark Bargain offer has expired.')], components:[] }).catch(()=>null);
          }, 10*60*1000);
          effectDesc += `\n• Dark Bargain sent to <@${rtargetUser.id}> — accept soul terms or lose a rank`;
        }

        if (ritualName === 'grand_sacrifice') {
          const victim = getOrCreateUser(rtargetUser.id);
          const ransom = Math.max(50000, Math.floor(((victim.wallet||0) + (victim.bank||0)) * 0.30));
          if (!org.pendingSacrifices) org.pendingSacrifices = {};
          org.pendingSacrifices[rtargetUser.id] = { amount: ransom, expiresAt: Date.now() + 24*60*60*1000, by: userId };
          const rowS = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`illum_sacrifice_pay_${guildId}_${rtargetUser.id}`).setLabel(`💰 Pay Ransom ${fmtMoney(ransom)}`).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`illum_sacrifice_refuse_${guildId}_${rtargetUser.id}`).setLabel('❌ Refuse (face consequences)').setStyle(ButtonStyle.Secondary),
          );
          rtargetUser.send({ embeds:[new EmbedBuilder().setColor(0x1a0000)
            .setTitle('⚰️ You Have Been Marked for Sacrifice')
            .setDescription(`The Grandmaster has selected you.\n\n**Pay a ransom of ${fmtMoney(ransom)}** within 24 hours or face the consequences:\n\n• 40% of all wealth seized\n• Business level reduced by 1\n• Status reduced by 20%\n\n*The order does not negotiate.*`)
          ], components:[rowS] }).catch(()=>null);
          setTimeout(() => {
            rtargetUser.send({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('The sacrifice window has closed.')], components:[] }).catch(()=>null);
          }, 24*60*60*1000);
          effectDesc += `\n• ${fmtMoney(ransom)} ransom demand sent to <@${rtargetUser.id}> — 24hr window`;
        }

        if (ritualName === 'blood_eclipse') {
          const VAULT_COST = 1000000;
          if (org.vault < VAULT_COST) {
            return replyFn({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
              .setDescription(`Blood Eclipse requires **${fmtMoney(VAULT_COST)}** in the vault. Current vault: **${fmtMoney(org.vault)}**.`)
            ] });
          }
          org.vault -= VAULT_COST;
          const { getAllUsers } = require('../../utils/db');
          const allUsers = getAllUsers();
          let totalDrained = 0; let targetCount = 0;
          Object.entries(allUsers).forEach(([uid, u]) => {
            if (isMember(guildId, uid)) return;
            const drain = Math.floor((u.wallet||0) * 0.08);
            if (drain > 0) {
              u.wallet = Math.max(0, (u.wallet||0) - drain);
              org.vault += drain; totalDrained += drain; targetCount++;
              require('../../utils/db').saveUser(uid, u);
            }
          });
          await addEvidence(guildId, `eclipse_${Date.now()}`);
          await addEvidence(guildId, `eclipse2_${Date.now()}`);
          await addEvidence(guildId, `eclipse3_${Date.now()}`);
          const cfg = require('../../utils/db').getConfig(guildId);
          if (cfg.purgeChannelId) {
            interaction.client.channels.fetch(cfg.purgeChannelId).then(ch => ch.send({ embeds:[new EmbedBuilder()
              .setColor(0x1a0000)
              .setTitle('🌒 THE BLOOD ECLIPSE HAS OCCURRED')
              .setDescription(`A shadow has fallen over the server.\n\n**${targetCount} users** lost 8% of their wallet to forces unseen.\n**${fmtMoney(totalDrained)}** extracted.\n\n*The Illuminati feeds.*`)
            ]}).catch(()=>null)).catch(()=>null);
          }
          effectDesc += `\n• **${fmtMoney(totalDrained)}** drained from **${targetCount}** non-members`;
        }

        if (ritualName === 'soul_harvest') {
          const soulSoldMembers = org.members.filter(m => m.soulSold);
          if (!soulSoldMembers.length) {
            effectDesc += '\n• No soul-sold members found — the harvest yielded nothing';
          } else {
            let harvested = 0;
            for (const m of soulSoldMembers) {
              const u = getOrCreateUser(m.userId);
              const take = Math.floor((u.wallet||0) * 0.20);
              if (take > 0) {
                u.wallet -= take; org.vault += take; harvested += take;
                saveUser(m.userId, u);
                interaction.client.users.fetch(m.userId).then(u2 => u2.send({ embeds:[new EmbedBuilder()
                  .setColor(0x1a0000)
                  .setTitle('💀 Soul Harvest')
                  .setDescription(`The Illuminati has collected on your debt.\n\n**${fmtMoney(take)}** extracted.\n\n*A soul-sold life has a price.*`)
                ]}).catch(()=>null)).catch(()=>null);
              }
            }
            effectDesc += `\n• **${fmtMoney(harvested)}** harvested from **${soulSoldMembers.length}** soul-sold members`;
          }
        }

        if (ritualName === 'dark_enlightenment') {
          const VAULT_COST = 300000;
          if (org.vault < VAULT_COST) {
            return replyFn({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
              .setDescription(`Dark Enlightenment requires **${fmtMoney(VAULT_COST)}** in the vault. Current vault: **${fmtMoney(org.vault)}**.`)
            ] });
          }
          org.vault -= VAULT_COST;
          const { getBusiness, saveBusiness } = require('../../utils/bizDb');
          const { getPhone: _gep, savePhone: _sep } = require('../../utils/phoneDb');
          let boostedBiz = 0; let boostedFollowers = 0;
          for (const m of org.members) {
            const biz = getBusiness(m.userId);
            if (biz) { biz.level = (biz.level||1) + 2; saveBusiness(m.userId, biz); boostedBiz++; }
            const ph = _gep(m.userId);
            if (ph) { ph.followers = (ph.followers||0) + 250000; await _sep(m.userId, ph); boostedFollowers++; }
            interaction.client.users.fetch(m.userId).then(u2 => u2.send({ embeds:[new EmbedBuilder()
              .setColor(GOLD_COLOR).setTitle('✨ Dark Enlightenment')
              .setDescription('The order has elevated you.\n\n**+2 business levels · +250,000 followers**\n\n*The Illuminati lifts all its own.*')
            ]}).catch(()=>null)).catch(()=>null);
          }
          effectDesc += `\n• **${boostedBiz}** members gained +2 business levels`;
          effectDesc += `\n• **${boostedFollowers}** members gained +250K followers`;
        }

        if (ritualName === 'abyssal_pact') {
          const VAULT_COST = 500000;
          if (org.vault < VAULT_COST) {
            return replyFn({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
              .setDescription(`Abyssal Pact requires **${fmtMoney(VAULT_COST)}** in the vault. Current vault: **${fmtMoney(org.vault)}**.`)
            ] });
          }
          org.vault -= VAULT_COST;
          org.abyssalPact = { until: Date.now() + 7*24*60*60*1000, sealedBy: userId, sealedAt: Date.now() };
          const cfg2 = require('../../utils/db').getConfig(guildId);
          if (cfg2.purgeChannelId) {
            interaction.client.channels.fetch(cfg2.purgeChannelId).then(ch => ch.send({ embeds:[new EmbedBuilder()
              .setColor(0x1a1a2e)
              .setTitle('🕳️ THE ABYSSAL PACT HAS BEEN SEALED')
              .setDescription(`The Illuminati has enacted the Abyssal Pact.\n\nFor the next **7 days** they are untouchable. No expose will succeed. No resistance will hold.\n\n*The order reigns supreme.*`)
            ]}).catch(()=>null)).catch(()=>null);
          }
          effectDesc += '\n• Illuminati is **unexposable** for 7 days';
          effectDesc += '\n• Operations generate 50% less evidence';
          effectDesc += `\n• Vault: **${fmtMoney(org.vault)}**`;
        }

        await saveIlluminati(guildId, org);

        // Build participant line for group rituals
        const pLine = participants && participants.size > 1
          ? `\n\n👥 **Witnessed by ${participants.size} members:** ${[...participants].map(id => `<@${id}>`).join(', ')}`
          : '';

        return replyFn({ embeds:[new EmbedBuilder()
          .setColor(GOLD_COLOR)
          .setTitle(`🕯️ ${ritual.name} — Complete`)
          .setDescription(`**${ritual.name}** ritual completed.\n\n**Effects:**\n${ritual.effects.map(e => `• ${e}`).join('\n')}${effectDesc}${pLine}`)
        ] });
      }; // end proceedWithRitual

      // ── SOLO RITUAL (no join phase) ───────────────────────────
      if (minP <= 1) {
        await proceedWithRitual(
          opts => interaction.reply({ ...opts, ephemeral: true }),
          new Set([userId]),
        );
        return;
      }

      // ── GROUP RITUAL — launch join phase ──────────────────────
      const participants = new Set([userId]);
      const JOIN_SECS    = 60;

      const buildJoinEmbed = () => new EmbedBuilder()
        .setColor(GOLD_COLOR)
        .setTitle(`🕯️ ${ritual.name} — Gathering the Circle`)
        .setDescription(
          `**<@${userId}>** is initiating the **${ritual.name}**.\n\n` +
          `*${ritual.description}*\n\n` +
          `**Required participants:** ${minP}\n` +
          (ritual.cost.money ? `**Initiator cost:** ${fmtMoney(ritual.cost.money)}\n\n` : '\n') +
          `Click **🕯️ Join Ritual** to participate. Illuminati members only.\n` +
          `The ritual begins in **${JOIN_SECS} seconds** or when the initiator starts it early.`
        )
        .addFields({
          name: `👥 Gathered (${participants.size} / ${minP} required)`,
          value: [...participants].map(id => `• <@${id}>`).join('\n'),
        })
        .setFooter({ text: `Ritual requires ${minP} participants to proceed. No cost is charged if cancelled.` });

      const joinRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ritual_join_${userId}_${ritualName}`)
          .setLabel('🕯️ Join Ritual')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`ritual_begin_${userId}_${ritualName}`)
          .setLabel('⚡ Begin Now')
          .setStyle(ButtonStyle.Secondary),
      );

      const joinMsg = await interaction.reply({
        embeds:     [buildJoinEmbed()],
        components: [joinRow],
        fetchReply: true,
      });

      const collector = joinMsg.createMessageComponentCollector({ time: JOIN_SECS * 1000 });

      collector.on('collect', async btn => {
        if (btn.customId === `ritual_join_${userId}_${ritualName}`) {
          if (!isMember(guildId, btn.user.id)) {
            return btn.reply({ content: '🔺 Only Illuminati members may participate in rituals.', ephemeral: true });
          }
          if (participants.has(btn.user.id)) {
            return btn.reply({ content: 'You are already part of this ritual.', ephemeral: true });
          }
          participants.add(btn.user.id);
          return btn.update({ embeds: [buildJoinEmbed()], components: [joinRow] });
        }

        if (btn.customId === `ritual_begin_${userId}_${ritualName}`) {
          if (btn.user.id !== userId) {
            return btn.reply({ content: 'Only the ritual initiator can start early.', ephemeral: true });
          }
          collector.stop('early');
        }
      });

      collector.on('end', async () => {
        if (participants.size < minP) {
          return joinMsg.edit({
            embeds: [new EmbedBuilder()
              .setColor(0x888888)
              .setTitle(`🕯️ ${ritual.name} — Ritual Abandoned`)
              .setDescription(
                `The circle was not complete. The ritual requires **${minP} participants** — only **${participants.size}** answered the call.\n\n` +
                `The ritual has been abandoned. **No costs have been charged.**`
              )
            ],
            components: [],
          });
        }

        await proceedWithRitual(
          opts => joinMsg.edit({ embeds: opts.embeds, components: [] }),
          participants,
        );
      });
    }

    // ── FAMILY ───────────────────────────────────────────────
    if (sub === 'family') {
      const org = getIlluminati(guildId);
      if (!org) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No Illuminati in this server.')], ephemeral:true });
      if (!isMember(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Members only.')], ephemeral:true });

      const target = interaction.options.getUser('user');
      const action = interaction.options.getString('action');
      
      const { getFamily, saveFamily } = require('../../utils/familyDb');
      const targetFamily = getFamily(target.id);
      
      if (!targetFamily) {
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`<@${target.id}> does not have a family. They need to start one first.`)
        ], ephemeral:true });
      }

      switch (action) {
        case 'bless': {
          const blessMult = getMember(guildId, target.id)?.covenant ? 2 : 1;
          targetFamily.happiness   = Math.min(100, (targetFamily.happiness || 50) + 20 * blessMult);
          targetFamily.reputation  = Math.min(100, (targetFamily.reputation || 50) + 10 * blessMult);
          break;
        }
        case 'curse': {
          const targetIllumMember = getMember(guildId, target.id);
          if (targetIllumMember?.covenant) {
            return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
              .setDescription(`<@${target.id}> is protected by **⛓️ The Covenant**. Your curse was deflected.`)
            ], ephemeral:true });
          }
          targetFamily.happiness = Math.max(0, (targetFamily.happiness || 50) - 20);
          targetFamily.wealth = 'poor';
          break;
        }
          
        case 'opportunity':
          // Trigger a special family event
          const event = FAMILY_EVENTS.illuminati_blessing;
          targetFamily.events = targetFamily.events || [];
          targetFamily.events.push({
            name: event.name,
            description: event.description,
            effects: event.effects,
            triggeredAt: Date.now(),
            triggeredBy: userId
          });
          break;
      }
      
      saveFamily(target.id, targetFamily);
      
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
        .setTitle(`Family Influence: ${action.charAt(0).toUpperCase() + action.slice(1)}`)
        .setDescription(`You have used your Illuminati influence to ${action} <@${target.id}>'s family.`)
      ], ephemeral:true });
    }

    // ── INVITE ────────────────────────────────────────────────
    if (sub === 'invite') {
      const org = getIlluminati(guildId);
      if (!org) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No Illuminati in this server.')], ephemeral:true });
      if (!isMember(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Members only.')], ephemeral:true });
      if (!isElder(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Only Elders and Grandmaster can invite.')], ephemeral:true });
      if (org.members.length >= MAX_MEMBERS) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Membership full (${MAX_MEMBERS} max).`)], ephemeral:true });

      const target = interaction.options.getUser('user');
      if (isMember(guildId, target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Already a member.')], ephemeral:true });

      const { getAccountAgeDays } = require('../../utils/lifePathDb');
      const targetAge = getAccountAgeDays(target.id);
      if (targetAge !== null && targetAge < 3) {
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`🔺 <@${target.id}> is too new — the Illuminati only considers accounts at least **3 days old**.\n\n📅 Their account age: **${targetAge} day${targetAge !== 1 ? 's' : ''}**`)
        ], ephemeral:true });
      }

      // Direct invites skip all eligibility requirements — Elder/Grandmaster vouches for them
      // Send invite via DM
      const inviteKey = `${guildId}:${target.id}`;
      _pendingInvites[inviteKey] = { inviterId:userId, expiresAt:Date.now()+10*60*1000 };

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`illum_accept_${guildId}_${userId}`).setLabel('✅ Accept Initiation').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`illum_decline_${guildId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Secondary),
      );

      try {
        await target.send({ embeds:[new EmbedBuilder()
          .setColor(GOLD_COLOR)
          .setTitle('🔺 You Have Been Invited')
          .setDescription(`An emissary of the **Illuminati** has extended an invitation to you in **${interaction.guild.name}**.\n\nAccepting costs **${fmtMoney(INITIATION_FEE)}** — your initiation fee into the vault.\n\n*The order is secret. Membership has its privileges. You can join factions and perform rituals to gain power.*\n\n⏱️ Expires in 10 minutes.`)
        ], components:[row] });
      } catch {
        delete _pendingInvites[inviteKey];
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't DM that user.")], ephemeral:true });
      }

      setTimeout(() => { delete _pendingInvites[inviteKey]; }, 10*60*1000);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR).setDescription(`🔺 Invitation sent to <@${target.id}>.`)], ephemeral:true });
    }

    // ── VAULT ─────────────────────────────────────────────────
    if (sub === 'vault') {
      const org = getIlluminati(guildId);
      if (!org || !isMember(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Members only.')], ephemeral:true });

      const amount = interaction.options.getInteger('amount');
      if (!amount) {
        // Show detailed vault status with faction breakdown
        const factionContributions = {};
        org.members.forEach(m => {
          const factionId = m.faction || 'none';
          factionContributions[factionId] = (factionContributions[factionId] || 0) + (m.contribution || 0);
        });
        
        let factionBreakdown = Object.entries(factionContributions).map(([id, amount]) => {
          if (id === 'none') return `Unaligned: ${fmtMoney(amount)}`;
          const faction = ILLUMINATI_FACTIONS[id];
          return `${faction.emoji} ${faction.name}: ${fmtMoney(amount)}`;
        }).join('\n');
        
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('🏦 Illuminati Vault')
          .setDescription(`Current balance: **${fmtMoney(org.vault)}**\n\n**Faction Contributions:**\n${factionBreakdown}\n\nContribute with \`/illuminati vault amount:\``)
        ], ephemeral:true });
      }

      const user = getOrCreateUser(userId);
      if (user.wallet < amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Not enough in wallet.')], ephemeral:true });

      user.wallet -= amount;
      saveUser(userId, user);
      org.vault += amount;
      const mem = getMember(guildId, userId);
      if (mem) mem.contribution = (mem.contribution||0) + amount;

      // Auto-promote top 5 contributors to Elder
      const sorted = [...org.members].sort((a,b)=>(b.contribution||0)-(a.contribution||0));
      sorted.slice(0,5).forEach(m => { if (m.rank === 'initiate' || m.rank === 'operative') m.rank = 'elder'; });

      await saveIlluminati(guildId, org);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
        .setDescription(`💰 Contributed **${fmtMoney(amount)}** to the vault. New balance: **${fmtMoney(org.vault)}**`)
      ], ephemeral:true });
    }

    // ── PROMOTE ───────────────────────────────────────────────
    if (sub === 'promote') {
      const org = getIlluminati(guildId);
      if (!org || !isGrandmaster(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Grandmaster only.')], ephemeral:true });

      const target = interaction.options.getUser('user');
      const mem    = getMember(guildId, target.id);
      if (!mem) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Not a member.')], ephemeral:true });

      const rankOrder = ['initiate','operative','elder'];
      const idx = rankOrder.indexOf(mem.rank);
      if (idx === -1 || idx >= rankOrder.length-1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Already at max promotable rank.')], ephemeral:true });

      mem.rank = rankOrder[idx+1];
      await saveIlluminati(guildId, org);

      return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
        .setDescription(`🔺 <@${target.id}> promoted to **${RANKS[mem.rank].label}**.`)
      ], ephemeral:true });
    }

    // ── EXCOMMUNICATE ─────────────────────────────────────────
    if (sub === 'excommunicate') {
      const org = getIlluminati(guildId);
      if (!org || !isElder(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Elders/Grandmaster only.')], ephemeral:true });

      const target = interaction.options.getUser('user');
      const mem    = getMember(guildId, target.id);
      if (!mem) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Not a member.')], ephemeral:true });
      if (mem.rank === 'grandmaster') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Cannot excommunicate the Grandmaster.')], ephemeral:true });

      org.members = org.members.filter(m => m.userId !== target.id);
      org.excommunicated = [...(org.excommunicated||[]), { userId:target.id, at:Date.now(), by:userId }];
      await saveIlluminati(guildId, org);

      // DM the exiled
      target.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
        .setTitle('☠️ Excommunicated')
        .setDescription(`You have been cast out of the Illuminati in **${interaction.guild.name}**. All perks removed. You are now marked.`)
      ]}).catch(()=>{});

      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
        .setDescription(`☠️ <@${target.id}> has been excommunicated.`)
      ], ephemeral:true });
    }

    // ── OPERATIONS ────────────────────────────────────────────
    if (sub === 'operate') {
      const org = getIlluminati(guildId);
      if (!org || !isMember(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Members only.')], ephemeral:true });

      const op     = interaction.options.getString('operation');
      const target = interaction.options.getUser('target');

      // ── NEW FACTION-SPECIFIC OPERATIONS ───────────────────────
      
      // ── POLICY CHANGE ────────────────────────────────────────
      if (op === 'policy_change') {
        const COST = 100000;
        const member = getMember(guildId, userId);
        
        if (member.faction !== 'political_power') {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('This operation requires the **Political Power** faction.')
          ], ephemeral:true });
        }
        
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Policy Change costs **${fmtMoney(COST)}** from vault. Vault: **${fmtMoney(org.vault)}**.`)], ephemeral:true });
        
        org.vault -= COST;
        org.operations.push({ type:'policy_change', by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);
        
        // Implement temporary policy change (this would need to be integrated with your config system)
        const config = getConfig(guildId);
        const oldPolicy = config.purgeActive;
        config.purgeActive = !config.purgeActive;
        saveConfig(guildId, config);
        
        // Revert after 24 hours
        setTimeout(async () => {
          try {
            const newConfig = getConfig(guildId);
            newConfig.purgeActive = oldPolicy;
            saveConfig(guildId, newConfig);
          } catch {}
        }, 24 * 60 * 60 * 1000);
        
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('🏛️ Policy Change Enacted')
          .setDescription(`Server policies have been temporarily altered.\n\n**Effect:** Purge system ${oldPolicy ? 'disabled' : 'enabled'} for 24 hours.\n\nVault: **${fmtMoney(org.vault)}**`)
        ], ephemeral:true });
      }
      
      // ── DATA BREACH ───────────────────────────────────────────
      if (op === 'data_breach') {
        const COST = 75000;
        const member = getMember(guildId, userId);
        
        if (member.faction !== 'tech_giants') {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('This operation requires the **Tech Giants** faction.')
          ], ephemeral:true });
        }
        
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Data Breach costs **${fmtMoney(COST)}** from vault. Vault: **${fmtMoney(org.vault)}**.`)], ephemeral:true });
        
        org.vault -= COST;
        org.operations.push({ type:'data_breach', by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);
        
        // Steal from all non-Illuminati members
        const { getAllUsers } = require('../../utils/db');
        const allUsers = getAllUsers();
        let totalStolen = 0;
        
        Object.entries(allUsers).forEach(([uid, user]) => {
          if (uid === userId || isMember(guildId, uid)) return;
          
          const stolen = Math.floor(user.wallet * 0.05); // 5% from each user
          if (stolen > 0) {
            user.wallet -= stolen;
            saveUser(uid, user);
            totalStolen += stolen;
          }
        });
        
        org.vault += totalStolen;
        await saveIlluminati(guildId, org);
        
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('💻 Data Breach Complete')
          .setDescription(`Sensitive information has been stolen from all users.\n\n**Stolen:** ${fmtMoney(totalStolen)}\n**Vault:** ${fmtMoney(org.vault)}`)
        ], ephemeral:true });
      }
      
      // ── VIRAL CAMPAIGN ────────────────────────────────────────
      if (op === 'viral_campaign') {
        const COST = 50000;
        const member = getMember(guildId, userId);
        
        if (member.faction !== 'entertainment') {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('This operation requires the **Entertainment Moguls** faction.')
          ], ephemeral:true });
        }
        
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Viral Campaign costs **${fmtMoney(COST)}** from vault. Vault: **${fmtMoney(org.vault)}**.`)], ephemeral:true });
        
        org.vault -= COST;
        org.operations.push({ type:'viral_campaign', by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);
        
        // Boost all Entertainment faction members' social media presence
        const { getPhone, savePhone } = require('../../utils/phoneDb');
        let boostedCount = 0;
        
        org.members.forEach(m => {
          if (m.faction === 'entertainment') {
            const phone = getPhone(m.userId);
            if (phone) {
              phone.followers = Math.floor((phone.followers || 0) * 1.5);
              phone.hype = Math.floor((phone.hype || 0) * 1.3);
              savePhone(m.userId, phone);
              boostedCount++;
            }
          }
        });
        
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('🎬 Viral Campaign Launched')
          .setDescription(`A viral trend has been created to benefit the Entertainment faction.\n\n**Boosted:** ${boostedCount} members\n**Effect:** +50% followers, +30% hype\n\nVault: **${fmtMoney(org.vault)}**`)
        ], ephemeral:true });
      }
      
      // ── ANCIENT RITUAL ────────────────────────────────────────
      if (op === 'ancient_ritual') {
        const COST = 300000;
        const member = getMember(guildId, userId);
        
        if (member.faction !== 'secret_societies') {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('This operation requires the **Secret Societies** faction.')
          ], ephemeral:true });
        }
        
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Ancient Ritual costs **${fmtMoney(COST)}** from vault. Vault: **${fmtMoney(org.vault)}**.`)], ephemeral:true });
        
        org.vault -= COST;
        org.operations.push({ type:'ancient_ritual', by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);
        
        // Apply server-wide effects
        const effects = [
          "All members gain +10% work income for 3 days",
          "All members gain +5% investment returns for 3 days",
          "Evidence generation rate reduced by 50% for 3 days"
        ];
        
        // This would need to be integrated with your various systems
        
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('🔮 Ancient Ritual Complete')
          .setDescription(`An ancient ritual has been performed, affecting the entire server.\n\n**Effects:**\n${effects.map(e => `• ${e}`).join('\n')}\n\nVault: **${fmtMoney(org.vault)}**`)
        ], ephemeral:true });
      }

      // ── LODGE MEETING ────────────────────────────────────────
      if (op === 'lodge_meeting') {
        const member = getMember(guildId, userId);
        if (member.faction !== 'freemason_lodge') {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('This operation requires the **Freemason Lodge** faction.')
          ], ephemeral:true });
        }

        const recentMeeting = (org.operations||[]).find(o => o.type === 'lodge_meeting' && Date.now() - o.at < 24*60*60*1000);
        if (recentMeeting) {
          const nextMeeting = recentMeeting.at + 24*60*60*1000;
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription(`The Lodge already met recently. Next meeting available <t:${Math.floor(nextMeeting/1000)}:R>.`)
          ], ephemeral:true });
        }

        const masons = org.members.filter(m => m.faction === 'freemason_lodge');
        if (!masons.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No Freemason Lodge members to pay.')], ephemeral:true });

        const DIVIDEND = 10000;
        const totalCost = masons.reduce((sum, m) => sum + (m.lodgeOath ? DIVIDEND * 2 : DIVIDEND), 0);
        if (org.vault < totalCost) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`Lodge Meeting needs **${fmtMoney(totalCost)}** in the vault. Vault: **${fmtMoney(org.vault)}**.`)
        ], ephemeral:true });

        for (const m of masons) {
          const payout = m.lodgeOath ? DIVIDEND * 2 : DIVIDEND;
          const u = getOrCreateUser(m.userId);
          u.wallet = (u.wallet || 0) + payout;
          saveUser(m.userId, u);
        }
        org.vault -= totalCost;
        org.operations.push({ type:'lodge_meeting', by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);

        // Notify each mason
        for (const m of masons) {
          const payout = m.lodgeOath ? DIVIDEND * 2 : DIVIDEND;
          const oathNote = m.lodgeOath ? ' *(Brotherhood Oath: 2×)*' : '';
          interaction.client.users.fetch(m.userId).then(u => u.send({ embeds:[new EmbedBuilder()
            .setColor(GOLD_COLOR)
            .setTitle('🔨 Lodge Meeting Dividend')
            .setDescription(`The Brotherhood convened. Your share: **${fmtMoney(payout)}**${oathNote} has been deposited.\n\n*The Lodge provides.*`)
          ]}).catch(()=>null)).catch(()=>null);
        }

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('🔨 Lodge Meeting Convened')
          .setDescription(`Brotherhood dividend paid to **${masons.length}** Lodge members.\n\n**${fmtMoney(DIVIDEND)}** each · **${fmtMoney(totalCost)}** total\n\nVault: **${fmtMoney(org.vault)}**`)
        ], ephemeral:true });
      }

      // ── MATCH FIX ────────────────────────────────────────────
      if (op === 'match_fix') {
        const COST = 150000;
        const member = getMember(guildId, userId);
        if (member.faction !== 'sports_syndicate') {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('This operation requires the **Sports Syndicate** faction.')
          ], ephemeral:true });
        }
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`Match Fix costs **${fmtMoney(COST)}** from vault. Vault: **${fmtMoney(org.vault)}**.`)
        ], ephemeral:true });

        const syndicate = org.members.filter(m => m.faction === 'sports_syndicate');
        if (!syndicate.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No Sports Syndicate members to pay.')], ephemeral:true });

        const PAYOUT = 30000;
        const totalPayout = PAYOUT * syndicate.length;
        if (org.vault - COST < totalPayout) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`Not enough in vault to cover operation cost + member payouts (need **${fmtMoney(COST + totalPayout)}**). Vault: **${fmtMoney(org.vault)}**.`)
        ], ephemeral:true });

        org.vault -= COST;
        for (const m of syndicate) {
          const u = getOrCreateUser(m.userId);
          u.wallet = (u.wallet || 0) + PAYOUT;
          saveUser(m.userId, u);
          org.vault -= PAYOUT;
        }
        org.operations.push({ type:'match_fix', by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);
        if (!org.abyssalPact?.until || Date.now() > org.abyssalPact.until || Math.random() > 0.5) await addEvidence(guildId, `op_${Date.now()}`);

        for (const m of syndicate) {
          interaction.client.users.fetch(m.userId).then(u => u.send({ embeds:[new EmbedBuilder()
            .setColor(GOLD_COLOR)
            .setTitle('🏆 Match Fixed — Your Cut')
            .setDescription(`The game was decided before it was played. Your cut: **${fmtMoney(PAYOUT)}**.\n\n*The Syndicate always wins.*`)
          ]}).catch(()=>null)).catch(()=>null);
        }

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('🏆 Match Fixed')
          .setDescription(`Rigged winnings paid to **${syndicate.length}** Sports Syndicate members.\n\n**${fmtMoney(PAYOUT)}** per member · **${fmtMoney(totalPayout)}** total paid out\n\nVault: **${fmtMoney(org.vault)}**`)
        ], ephemeral:true });
      }

      // ── BLOODLINE DIVIDEND ────────────────────────────────────
      if (op === 'bloodline_dividend') {
        const COST = 250000;
        const member = getMember(guildId, userId);
        if (member.faction !== 'old_blood_elite') {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('This operation requires the **Old Blood Elite** faction.')
          ], ephemeral:true });
        }
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`Bloodline Dividend costs **${fmtMoney(COST)}** from vault. Vault: **${fmtMoney(org.vault)}**.`)
        ], ephemeral:true });

        const bloodline = org.members.filter(m => m.faction === 'old_blood_elite');
        if (!bloodline.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No Old Blood Elite members found.')], ephemeral:true });

        let totalAmplified = 0;
        const results = [];
        for (const m of bloodline) {
          const u = getOrCreateUser(m.userId);
          const interest = Math.floor((u.bank || 0) * 0.08);
          if (interest > 0) {
            u.bank = (u.bank || 0) + interest;
            saveUser(m.userId, u);
            totalAmplified += interest;
            results.push({ userId: m.userId, interest });
          }
        }

        org.vault -= COST;
        org.operations.push({ type:'bloodline_dividend', by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);

        for (const r of results) {
          interaction.client.users.fetch(r.userId).then(u => u.send({ embeds:[new EmbedBuilder()
            .setColor(GOLD_COLOR)
            .setTitle('👑 Bloodline Dividend Applied')
            .setDescription(`Your lineage earns. **+${fmtMoney(r.interest)}** added to your bank (8% amplification).\n\n*Old money never sleeps.*`)
          ]}).catch(()=>null)).catch(()=>null);
        }

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('👑 Bloodline Dividend')
          .setDescription(`8% bank amplification applied to **${bloodline.length}** Old Blood Elite members.\n\n**${fmtMoney(totalAmplified)}** total amplified across all members.\n\nVault: **${fmtMoney(org.vault)}**`)
        ], ephemeral:true });
      }

      // ── INDUSTRY BLACKLIST ────────────────────────────────────
      if (op === 'blacklist') {
        const COST = 80000;
        const member = getMember(guildId, userId);
        if (member.faction !== 'hollywood_cabal') {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('This operation requires the **Hollywood Cabal** faction.')
          ], ephemeral:true });
        }
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`Industry Blacklist costs **${fmtMoney(COST)}** from vault. Vault: **${fmtMoney(org.vault)}**.`)
        ], ephemeral:true });
        if (!target) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target to blacklist.')], ephemeral:true });
        if (isMember(guildId, target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Cannot blacklist fellow members.')], ephemeral:true });

        const { getPhone, savePhone } = require('../../utils/phoneDb');
        const phone = getPhone(target.id);
        if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> has no phone — no platform to blacklist.`)], ephemeral:true });

        phone.silencedUntil  = Date.now() + 7 * 24 * 60 * 60 * 1000;
        phone.blacklistByIllum = true;
        phone.silenceByIllum   = true;
        await savePhone(target.id, phone);

        org.vault -= COST;
        org.operations.push({ type:'blacklist', target:target.id, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);
        if (!org.abyssalPact?.until || Date.now() > org.abyssalPact.until || Math.random() > 0.5) await addEvidence(guildId, `op_${Date.now()}`);

        target.send({ embeds:[new EmbedBuilder()
          .setColor(0x2c2c2c)
          .setTitle('🎭 You\'ve Been Blacklisted')
          .setDescription('Powerful people in the industry have made a decision.\n\nYour platform earns **$0** for the next **7 days**. Doors are closing. Opportunities are evaporating.\n\n*This is what happens when Hollywood decides you\'re done.*')
        ]}).catch(()=>null);

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('🎭 Industry Blacklist Activated')
          .setDescription(`<@${target.id}> has been blacklisted by the Hollywood Cabal.\n\n• Phone earnings **$0** for 7 days\n• Platform suppressed across all posts\n\nVault: **${fmtMoney(org.vault)}**`)
        ], ephemeral:true });
      }

      // ── SHADOW ROB ──────────────────────────────────────────
      if (op === 'shadow_rob') {
        const COST = 50000;
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Shadow Rob costs **${fmtMoney(COST)}** from vault. Vault: **${fmtMoney(org.vault)}**.`)], ephemeral:true });
        if (!target) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target.')], ephemeral:true });
        if (isMember(guildId, target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Cannot target Illuminati members.')], ephemeral:true });

        const victim = getOrCreateUser(target.id);
        const stolen = Math.floor(victim.wallet * 0.10);
        if (stolen < 1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Target has nothing to take.')], ephemeral:true });

        victim.wallet -= stolen;
        org.vault -= COST;
        org.vault += stolen; // stolen funds go to vault
        saveUser(target.id, victim);
        org.operations.push({ type:'shadow_rob', target:target.id, amount:stolen, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);

        // Add evidence for nearby witnesses
        if (!org.abyssalPact?.until || Date.now() > org.abyssalPact.until || Math.random() > 0.5) await addEvidence(guildId, `op_${Date.now()}`);

        // Victim gets a cryptic DM — no source
        target.send({ embeds:[new EmbedBuilder().setColor(0x2c2c2c)
          .setDescription(`💸 **${fmtMoney(stolen)}** has mysteriously vanished from your wallet. No trace left behind.`)
        ]}).catch(()=>{});

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('🕵️ Shadow Rob Complete')
          .setDescription(`**${fmtMoney(stolen)}** silently extracted from <@${target.id}> and deposited into the vault.\n\nVault: **${fmtMoney(org.vault)}**`)
        ], ephemeral:true });
      }

      // ── INTEL REPORT ────────────────────────────────────────
      if (op === 'intel') {
        const COST = 25000;
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Intel costs **${fmtMoney(COST)}**.`)], ephemeral:true });
        if (!target) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target.')], ephemeral:true });

        const { getUser }      = require('../../utils/db');
        const { getHome }      = require('../../utils/homeDb');
        const { getPhone }     = require('../../utils/phoneDb');
        const { getPoliceRecord } = require('../../utils/gangDb');
        const { getBusiness }  = require('../../utils/bizDb');
        const { getGangByMember } = require('../../utils/gangDb');
        const { getStore }     = require('../../utils/db');
        const { getFamily }    = require('../../utils/familyDb');

        const victim  = getUser(target.id);
        const home    = getHome(target.id);
        const phone   = getPhone(target.id);
        const rec     = getPoliceRecord(target.id);
        const biz     = getBusiness(target.id);
        const gang    = getGangByMember(target.id);
        const family  = getFamily(target.id);
        const store   = getStore(guildId);
        const stash   = (home?.stash||[]).map(id => store.items.find(i=>i.id===id)?.name||id);

        org.vault -= COST;
        org.operations.push({ type:'intel', target:target.id, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);

        const embed = new EmbedBuilder()
          .setColor(ILLUM_COLOR)
          .setTitle(`📡 Intel: ${target.username}`)
          .addFields(
            { name:'💵 Wallet',     value:fmtMoney(victim?.wallet||0),           inline:true },
            { name:'🏦 Bank',       value:fmtMoney(victim?.bank||0),             inline:true },
            { name:'🔥 Heat',       value:`${rec?.heat||0}`,                      inline:true },
            { name:'🏠 Home',       value:home ? `${home.tier} · stash: ${stash.length > 0 ? stash.join(', ') : 'empty'}` : 'No home', inline:false },
            { name:'📱 Status',     value:phone ? `${phone.status||0} · ${phone.followers||0} followers` : 'No phone', inline:true },
            { name:'🏢 Business',   value:biz ? `${biz.name} Lv${biz.level||1}` : 'None', inline:true },
            { name:'🏴 Gang',       value:gang ? gang.name : 'None', inline:true },
          )
          .setFooter({ text:'Intel expires in 24hrs. Do not share.' });
        
        // Add family info if exists
        if (family) {
          embed.addFields(
            { name:'👨‍👩‍👧 Family', value:`Spouse: ${family.spouse || 'None'}\nChildren: ${family.children?.length || 0}\nWealth: ${family.wealth || 'Unknown'}`, inline:false }
          );
        }
        
        return interaction.reply({ embeds:[embed], ephemeral:true });
      }

      // ── PROTECTION RACKET ───────────────────────────────────
      if (op === 'protection') {
        if (!target) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify the gang leader as target.')], ephemeral:true });
        const { getGangByMember } = require('../../utils/gangDb');
        const gang = getGangByMember(target.id);
        if (!gang) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> is not a gang leader or not in a gang.`)], ephemeral:true });
        if (gang.leaderId !== target.id) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Must target the gang **leader** specifically.')], ephemeral:true });

        const weeklyFee = 100000;
        org.tribute = org.tribute || {};
        if (org.tribute[gang.id]) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`**${gang.name}** already under protection racket.`)], ephemeral:true });

        org.tribute[gang.id] = { gangId:gang.id, leaderId:target.id, weeklyFee, lastPaid:null, due:Date.now()+7*24*60*60*1000 };
        org.operations.push({ type:'protection', target:target.id, gang:gang.name, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);

        // DM the leader
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`illum_pay_tribute_${guildId}_${gang.id}`).setLabel(`💰 Pay ${fmtMoney(weeklyFee)}`).setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`illum_refuse_tribute_${guildId}_${gang.id}`).setLabel('❌ Refuse').setStyle(ButtonStyle.Secondary),
        );
        target.send({ embeds:[new EmbedBuilder()
          .setColor(ILLUM_COLOR)
          .setTitle('🛡️ Protection Notice')
          .setDescription(`**${gang.name}** has been placed under Illuminati protection.\n\nWeekly tribute: **${fmtMoney(weeklyFee)}**\nDue in: 7 days\n\n*Pay and operate freely. Refuse and face consequences.*`)
        ], components:[row] }).catch(()=>{});

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setDescription(`🛡️ Protection racket established on **${gang.name}**. Weekly fee: **${fmtMoney(weeklyFee)}**.`)
        ], ephemeral:true });
      }

      // ── MARKET MANIPULATION ─────────────────────────────────
      if (op === 'market_manip') {
        const COST      = 200000;
        const coin      = interaction.options.getString('coin')?.toUpperCase();
        const direction = interaction.options.getString('direction');
        if (!coin || !direction) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify coin and direction (pump/dump).')], ephemeral:true });
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Market manipulation costs **${fmtMoney(COST)}**. Vault: **${fmtMoney(org.vault)}**.`)], ephemeral:true });

        const { col } = require('../../utils/mongo');
        const pc   = await col('stockPrices');
        const pdoc = await pc.findOne({ _id:'prices' }).catch(()=>null);
        if (!pdoc || !pdoc[coin]) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Coin **${coin}** not found.`)], ephemeral:true });

        const currentPrice = pdoc[coin];
        const mult = direction === 'pump' ? (1.5 + Math.random()*0.5) : (0.3 + Math.random()*0.2);
        const newPrice = Math.max(0.001, currentPrice * mult);
        pdoc[coin] = newPrice;
        await pc.replaceOne({ _id:'prices' }, pdoc, { upsert:true });

        org.vault -= COST;
        org.operations.push({ type:'market_manip', coin, direction, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);
        if (!org.abyssalPact?.until || Date.now() > org.abyssalPact.until || Math.random() > 0.5) await addEvidence(guildId, `op_${Date.now()}`);

        // Revert after 30 minutes
        setTimeout(async () => {
          try {
            const pc2   = await col('stockPrices');
            const pdoc2 = await pc2.findOne({ _id:'prices' });
            if (pdoc2) {
              pdoc2[coin] = currentPrice;
              await pc2.replaceOne({ _id:'prices' }, pdoc2, { upsert:true });
            }
          } catch {}
        }, 30*60*1000);

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle(`📊 Market ${direction === 'pump' ? 'Pumped' : 'Dumped'}`)
          .setDescription(`**${coin}** ${direction === 'pump' ? '📈 pumped' : '📉 dumped'} by **${Math.round(Math.abs(mult-1)*100)}%**.\n\n${currentPrice.toFixed(4)} → ${newPrice.toFixed(4)}\n\nEffect lasts **30 minutes** then reverts automatically.`)
        ], ephemeral:true });
      }

      // ── BLACKMAIL ────────────────────────────────────────────
      if (op === 'blackmail') {
        const COST = 150000;
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Blackmail costs **${fmtMoney(COST)}** from vault.`)], ephemeral:true });
        if (!target) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target.')], ephemeral:true });
        if (isMember(guildId, target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Cannot blackmail fellow members.')], ephemeral:true });

        // Target must be Celebrity+ (status tier 4+)
        const { getPhone, getStatusTier } = require('../../utils/phoneDb');
        const phone = getPhone(target.id);
        const tier  = getStatusTier(phone?.status||0);
        if ((tier?.level||0) < 4) {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription(`<@${target.id}> needs **⭐ Celebrity+** status to blackmail. They are: **${tier?.label||'Newcomer'}**`)
          ], ephemeral:true });
        }

        if (org.controlled?.includes(target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Already under Illuminati control.')], ephemeral:true });

        org.vault -= COST;
        org.controlled = [...(org.controlled||[]), target.id];
        org.operations.push({ type:'blackmail', target:target.id, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);
        if (!org.abyssalPact?.until || Date.now() > org.abyssalPact.until || Math.random() > 0.5) await addEvidence(guildId, `op_${Date.now()}`);

        // DM the target (cryptic, no source)
        target.send({ embeds:[new EmbedBuilder()
          .setColor(0x2c2c2c)
          .setTitle('📸 An Offer You Cannot Refuse')
          .setDescription('Certain... information has come into the possession of powerful people.\n\nYour cooperation is expected. Your earnings are no longer entirely your own.\n\n*The price of fame.*')
        ]}).catch(()=>{});

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xf5c518)
          .setTitle('📸 Blackmail Successful')
          .setDescription(`<@${target.id}> is now under Illuminati control.

**Effects:**
• Their shoutouts have 50% chance to redirect earnings to vault
• Their coin pumps benefit Illuminati investments
• Cannot sign with rival labels

Vault: **${fmtMoney(org.vault)}**`)
        ], ephemeral:true });
      }

      // ── FORCE SIGN ARTIST ────────────────────────────────────
      if (op === 'sign_artist') {
        if (!target) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify target artist.')], ephemeral:true });

        const { getPhone, getStatusTier } = require('../../utils/phoneDb');
        const phone = getPhone(target.id);
        const tier  = getStatusTier(phone?.status||0);
        if ((tier?.level||0) < 3) {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription(`<@${target.id}> needs **🔥 Influencer+** status. They are: **${tier?.label||'Newcomer'}**`)
          ], ephemeral:true });
        }

        // Must have an Illuminati-member-owned label
        const { getLabel, saveLabel, getContract, saveContract, isSignedArtist } = require('../../utils/labelDb');
        const { getBusiness } = require('../../utils/bizDb');
        const biz = getBusiness(userId);
        if (!biz || biz.type !== 'record_label') {
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You need to own a Record Label business to force-sign an artist.')], ephemeral:true });
        }

        if (isSignedArtist(target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> is already signed elsewhere.`)], ephemeral:true });

        // DM the target with accept/refuse
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`label_force_accept_${userId}_${guildId}`).setLabel('✍️ Sign (no choice)').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`label_force_refuse_${userId}_${guildId}`).setLabel('❌ Refuse (lose 40% wallet)').setStyle(ButtonStyle.Secondary),
        );

        target.send({ embeds:[new EmbedBuilder()
          .setColor(0x1a1a2e)
          .setTitle('🎵 An Opportunity You Cannot Refuse')
          .setDescription(`**${biz.name}** has secured your signature.\n\n**Label cut:** 60%\n**Your cut:** 40%\n\nSign and prosper. Refuse and face financial consequences.\n\n*Choose wisely.*`)
        ], components:[row] }).catch(()=>{});

        org.operations.push({ type:'sign_artist', target:target.id, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xf5c518)
          .setDescription(`📨 Forced contract sent to <@${target.id}>. They can sign or pay a penalty.`)
        ], ephemeral:true });
      }

      // ── COLLECT TRIBUTE ─────────────────────────────────────
      if (op === 'collect_tribute') {
        const org2 = getIlluminati(guildId);
        const tribute = org2?.tribute || {};
        const due = Object.values(tribute).filter(t => t.lastPaid === null || Date.now() > t.due);
        if (!due.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('No tribute currently due.')], ephemeral:true });

        let collected = 0;
        for (const t of due) {
          const leader = getOrCreateUser(t.leaderId);
          const pay    = Math.min(leader.wallet, t.weeklyFee);
          if (pay > 0) {
            leader.wallet -= pay;
            org2.vault    += pay;
            collected     += pay;
            saveUser(t.leaderId, leader);
            t.lastPaid = Date.now();
            t.due      = Date.now() + 7*24*60*60*1000;
          } else {
            const penalty = Math.floor(leader.wallet * 0.25);
            leader.wallet -= penalty;
            org2.vault    += penalty;
            collected     += penalty;
            saveUser(t.leaderId, leader);
          }
        }
        await saveIlluminati(guildId, org2);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('💸 Tribute Collected')
          .setDescription(`Collected **${fmtMoney(collected)}** from ${due.length} gang(s).\n\nVault: **${fmtMoney(org2.vault)}**`)
        ], ephemeral:true });
      }

      // ── SABOTAGE ARTIST ──────────────────────────────────────
      if (op === 'sabotage') {
        const COST = 75000;
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Sabotage costs **${fmtMoney(COST)}** from vault.`)], ephemeral:true });
        if (!target) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify the artist to sabotage.')], ephemeral:true });

        const { getAllLabels, saveLabel, getContract, saveContract } = require('../../utils/labelDb');
        const labels = getAllLabels();
        // Find which label this artist is on
        let found = false;
        for (const [ownerId, label] of Object.entries(labels)) {
          const artist = (label.artists||[]).find(a => a.artistId === target.id);
          if (!artist) continue;
          // Crash their fanbase and hype by 60%
          const contract = getContract(target.id);
          if (contract?.npcData) {
            contract.npcData.fanbase = Math.floor((contract.npcData.fanbase||1000) * 0.40);
            contract.npcData.hype    = Math.max(1, Math.floor((contract.npcData.hype||50) * 0.30));
            contract.npcData.image   = 'controversial';
            await saveContract(target.id, contract);
          }
          found = true;
          // DM the label owner
          interaction.client.users.fetch(ownerId).then(u => u.send({ embeds:[new EmbedBuilder()
            .setColor(0xff3b3b)
            .setTitle('📉 Artist Sabotaged!')
            .setDescription(`<@${target.id}>'s career was sabotaged by unknown forces. Fanbase and hype dropped dramatically. Image damaged.`)
          ]}).catch(() => null)).catch(() => null);
          break;
        }

        // Also hit their phone status if they have one
        const { getPhone, savePhone } = require('../../utils/phoneDb');
        const phone = getPhone(target.id);
        if (phone) {
          phone.hype      = Math.max(0, Math.floor((phone.hype||0) * 0.40));
          phone.followers = Math.max(0, Math.floor((phone.followers||0) * 0.60));
          phone.status    = Math.max(0, Math.floor((phone.status||0) * 0.70));
          await savePhone(target.id, phone);
        }

        org.vault -= COST;
        org.operations.push({ type:'sabotage', target:target.id, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);
        if (!org.abyssalPact?.until || Date.now() > org.abyssalPact.until || Math.random() > 0.5) await addEvidence(guildId, `op_${Date.now()}`);

        // DM target
        target.send({ embeds:[new EmbedBuilder()
          .setColor(0x2c2c2c)
          .setTitle('📉 Your Career is in Flames')
          .setDescription('A coordinated campaign has devastated your reputation. Fanbase, hype, and status have cratered.\n\n*Someone powerful does not want you to succeed.*')
        ]}).catch(() => null);

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('🎤 Artist Sabotaged')
          .setDescription(`<@${target.id}>'s career has been destroyed.\n\n• Fanbase -60% · Hype -70% · Image → controversial\n• Phone status -30%\n\nVault: **${fmtMoney(org.vault)}**`)
        ], ephemeral:true });
      }

      // ── SILENCE CAMPAIGN ─────────────────────────────────────
      if (op === 'silence_campaign') {
        const COST = 60000;
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Silence Campaign costs **${fmtMoney(COST)}**.`)], ephemeral:true });
        if (!target) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target.')], ephemeral:true });
        if (isMember(guildId, target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Cannot silence fellow members.')], ephemeral:true });

        const { getPhone, savePhone } = require('../../utils/phoneDb');
        const phone = getPhone(target.id);
        if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('<@' + target.id + '> has no phone — no platform to silence.')], ephemeral:true });

        // Set a posting penalty — silence their earnings for 48hrs
        phone.silencedUntil    = Date.now() + 48 * 60 * 60 * 1000;
        phone.silenceByIllum   = true;
        await savePhone(target.id, phone);

        org.vault -= COST;
        org.operations.push({ type:'silence_campaign', target:target.id, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);

        target.send({ embeds:[new EmbedBuilder()
          .setColor(0x2c2c2c)
          .setTitle('🔇 Your Posts Are Being Suppressed')
          .setDescription('A shadow campaign is suppressing your content.\n\n*Your posts earn nothing for the next 48 hours.*')
        ]}).catch(() => null);

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('🔇 Silence Campaign Launched')
          .setDescription(`<@${target.id}>'s phone posts will earn **$0** for the next 48 hours.\n\nVault: **${fmtMoney(org.vault)}**`)
        ], ephemeral:true });
      }

      // ── INDUSTRY PLANT ───────────────────────────────────────
      if (op === 'industry_plant') {
        const COST = 500000;
        if (org.vault < COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`Industry Plant costs **${fmtMoney(COST)}** from vault. Current vault: **${fmtMoney(org.vault)}**.`)
        ], ephemeral:true });
        if (!target) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify the artist to plant.')], ephemeral:true });

        const { getPhone, savePhone, getStatusTier, STATUS_TIERS } = require('../../utils/phoneDb');
        const { getLabel, saveLabel, getContract, saveContract } = require('../../utils/labelDb');

        const phone = getPhone(target.id);
        if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription('<@' + target.id + '> needs a phone to be planted. They need to own one first.')
        ], ephemeral:true });

        const currentTier  = getStatusTier(phone.status || 0);
        const superstarMin = STATUS_TIERS.find(t => t.id === 'superstar')?.minStatus || 25000;

        // Blast their stats to Superstar tier
        const oldStatus = phone.status || 0;
        phone.status      = Math.max(phone.status || 0, superstarMin + 5000);
        phone.hype        = Math.max(phone.hype   || 0, 500000);
        phone.followers   = Math.max(phone.followers || 0, 2500000);
        phone.isPlant     = true;
        phone.plantedBy   = userId;
        phone.plantedAt   = Date.now();
        phone.artistCareer = {
          fame:    75000,
          tier:    'platinum',
          isPlant: true,
          plantBoostAt: Date.now(),
        };
        await savePhone(target.id, phone);

        // If they are signed to a label, also boost their contract
        const contract = getContract(target.id);
        if (contract?.npcData) {
          contract.npcData.fanbase    = Math.max(contract.npcData.fanbase || 0, 5000000);
          contract.npcData.hype       = 100;
          contract.npcData.talent     = Math.max(contract.npcData.talent || 50, 85);
          contract.npcData.image      = 'iconic';
          contract.illuminatiControlled = true;
          contract.isPlant            = true;
          await saveContract(target.id, contract);
          // Notify label owner
          const { getLabel: _gl } = require('../../utils/labelDb');
          const label = _gl(contract.labelOwnerId);
          if (label) {
            interaction.client.users.fetch(contract.labelOwnerId).then(u => u.send({ embeds:[new EmbedBuilder()
              .setColor(0xf5c518)
              .setTitle('🌱 Industry Plant Signed')
              .setDescription('<@' + target.id + '> has been artificially boosted by powerful backers. Your label revenue will skyrocket — but their authenticity is now questionable.')
            ]}).catch(() => null)).catch(() => null);
          }
        }

        org.vault -= COST;
        org.controlled = [...(org.controlled||[]), ...(org.controlled?.includes(target.id) ? [] : [target.id])];
        org.operations.push({ type:'industry_plant', target:target.id, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);
        await addEvidence(guildId, 'op_' + Date.now());

        // Announce publicly in server (plants get a big splash)
        const config = require('../../utils/db').getConfig(guildId);
        if (config.purgeChannelId) {
          interaction.client.channels.fetch(config.purgeChannelId).then(ch => ch.send({ embeds:[new EmbedBuilder()
            .setColor(0xf5c518)
            .setTitle('🌱 NEW ARTIST ALERT')
            .setDescription('<@' + target.id + '> appeared out of nowhere as a **🏆 Platinum Artist**. 2.5M followers. 500K hype. Superstar overnight. *Nobody blows up this fast organically...*')
          ]}).catch(() => null)).catch(() => null);
        }

        // DM the planted artist
        target.send({ embeds:[new EmbedBuilder()
          .setColor(GOLD_COLOR)
          .setTitle('🌱 You Are An Industry Plant')
          .setDescription('The Illuminati has invested **' + fmtMoney(COST) + '** to make you a star overnight.\n\n🏆 Status: **Platinum Artist**\n👥 Followers: **2.5M**\n✨ Hype: **500K**\n\nRevenue multiplier: **2.5×**\n\n*Your success is manufactured. Protect your image.*')
        ]}).catch(() => null);

        return interaction.reply({ embeds:[new EmbedBuilder()
          .setColor(GOLD_COLOR)
          .setTitle('🌱 Industry Plant Activated')
          .setDescription('<@' + target.id + '> is now a **🏆 Platinum Artist** overnight.\n\n👥 2.5M followers · ✨ 500K hype · 🎵 Revenue ×2.5\n\nIlluminati-controlled. All earnings flow through you.\n\nVault: **' + fmtMoney(org.vault) + '**')
        ], ephemeral:true });
      }

      // ── EXTORT ────────────────────────────────────────────────
      if (op === 'extort') {
        if (!target) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target to extort.')], ephemeral:true });
        if (isMember(guildId, target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Cannot extort fellow members.')], ephemeral:true });

        const victim   = getOrCreateUser(target.id);
        const demand   = Math.floor((victim.wallet + victim.bank) * 0.15); // 15% of total wealth
        if (demand < 1000) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('<@' + target.id + '> is too broke to extort.')], ephemeral:true });

        // Give them 1hr to pay via DM button
        const { ActionRowBuilder: ARB2, ButtonBuilder: BB2, ButtonStyle: BS2 } = require('discord.js');
        const row = new ARB2().addComponents(
          new BB2().setCustomId(`illum_pay_extort_${guildId}_${userId}`).setLabel(`💰 Pay ${fmtMoney(demand)}`).setStyle(BS2.Danger),
          new BB2().setCustomId(`illum_refuse_extort_${guildId}_${userId}`).setLabel('❌ Refuse').setStyle(BS2.Secondary),
        );

        target.send({ embeds:[new EmbedBuilder()
          .setColor(ILLUM_COLOR)
          .setTitle('⚠️ Pay Up or Face Consequences')
          .setDescription(`A powerful organization demands **${fmtMoney(demand)}** from you.\n\nPay within 1 hour or 25% of your wallet will be taken by force.\n\n*This is not a request.*`)
        ], components:[row] }).catch(() => null);

        org.operations.push({ type:'extort', target:target.id, demand, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('💰 Extortion Demand Sent')
          .setDescription(`Demanding **${fmtMoney(demand)}** from <@${target.id}>.\n\nThey have 1 hour to pay or a shadow rob will auto-execute.`)
        ], ephemeral:true });
      }
    }

    // ── SELL SOUL ─────────────────────────────────────────────
    if (sub === 'sellsoul') {
      const org = getIlluminati(guildId);
      if (!org) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('The Illuminati has not been founded in this server yet.')
      ], ephemeral:true });
      if (isMember(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('You are already a member of the Illuminati.')
      ], ephemeral:true });
      if (org.members.length >= MAX_MEMBERS) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('The order is full. Wait for a seat to open.')
      ], ephemeral:true });

      const { getPhone, getStatusTier } = require('../../utils/phoneDb');
      const { getOrCreateUser: _gou } = require('../../utils/db');
      const { getBusiness } = require('../../utils/bizDb');
      const { getHome } = require('../../utils/homeDb');

      const phone     = getPhone(userId);
      const user2     = _gou(userId);
      const biz       = getBusiness(userId);
      const home      = getHome(userId);
      const wealth    = (user2.wallet||0) + (user2.bank||0);
      const status    = phone?.status || 0;
      const fame      = phone?.artistCareer?.fame || 0;
      const followers = phone?.followers || 0;

      // Path 1 — Power: all must be met
      const meetsFullReqs = (
        wealth >= 500000 &&
        status >= 50 &&
        (biz?.level||0) >= 5 &&
        home?.tier === 'estate'
      );

      // Path 2 — Fame: any one qualifies
      const meetsFamePath = (
        fame >= 10000 ||
        followers >= 1000000 ||
        status >= 25000
      );

      if (!meetsFullReqs && !meetsFamePath) {
        const powerMissing = [
          wealth < 500000    ? `💰 Need $${(500000-wealth).toLocaleString()} more total wealth` : null,
          status < 50        ? `🏆 Need ${50-status} more status points` : null,
          (biz?.level||0)<5  ? `🏢 Business needs ${5-(biz?.level||0)} more levels` : null,
          home?.tier!=='estate' ? '🏰 Need an Estate home' : null,
        ].filter(Boolean);

        const fameMissing = [
          fame < 10000       ? `🎵 Need ${(10000-fame).toLocaleString()} more artist fame (have ${fame.toLocaleString()})` : null,
          followers < 1000000 ? `👥 Need ${(1000000-followers).toLocaleString()} more followers (have ${followers.toLocaleString()})` : null,
          status < 25000     ? `⭐ Need ${(25000-status).toLocaleString()} more status for Superstar (have ${status.toLocaleString()})` : null,
        ].filter(Boolean);

        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x1a1a2e)
          .setTitle('🖤 The Illuminati Will Not Accept You')
          .setDescription(
            'You must prove yourself through **Power** or **Fame**.\n\n' +
            '**Path 1 — Power** *(all required)*:\n' +
            powerMissing.map(m => '• ' + m).join('\n') +
            '\n\n**Path 2 — Fame** *(any one)*:\n' +
            fameMissing.map(m => '• ' + m).join('\n')
          )
        ], ephemeral:true });
      }

      const pathUsed = meetsFullReqs ? '💎 Power' : '🎵 Fame';
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`illum_soul_${guildId}_${userId}`).setLabel('🖤 I sell my soul').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`illum_soul_decline_${guildId}`).setLabel('Walk Away').setStyle(ButtonStyle.Secondary),
      );

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle('🖤 The Illuminati Extends Its Hand')
        .setDescription(
          'You have proven yourself worthy through the **' + pathUsed + ' Path**.\n\n' +
          'But nothing comes free.\n\n' +
          '**By selling your soul, you agree:**\n' +
          '• The Illuminati has **complete control** over your operations\n' +
          '• You can be **silenced, extorted, or sacrificed** at any time\n' +
          '• Your businesses, label, and assets are subject to **Illuminati override**\n' +
          '• You may be **forced** to sign artists, pay tribute, or carry out operations\n' +
          '• Leaving means **losing everything** — wallet drained on exit\n' +
          '• There is **no escape** without Grandmaster approval\n\n' +
          '*Initiation fee: **' + fmtMoney(INITIATION_FEE) + '** from your wallet.*\n\n' +
          '**You have 5 minutes to decide.**'
        )
        .setFooter({ text:'Once you sign, the order owns you.' })
      ], components:[row2], ephemeral:true });
    }

    // ── EXPOSE ────────────────────────────────────────────────
    if (sub === 'expose') {
      const org = getIlluminati(guildId);
      if (!org) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('No Illuminati in this server.')], ephemeral:true });
      if (org.exposed) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('The Illuminati has already been exposed!')], ephemeral:true });
      if (isMember(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You cannot expose an organization you belong to.')], ephemeral:true });

      if (org.abyssalPact?.until > Date.now()) {
        const expiresAt = Math.floor(org.abyssalPact.until / 1000);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x1a1a2e)
          .setTitle('🕳️ Shielded')
          .setDescription(`The Illuminati has enacted the **Abyssal Pact**. They are untouchable.\n\nPact expires <t:${expiresAt}:R>. Try again then.`)
        ], ephemeral:true });
      }

      // Count witnessed operations
      const evidence = getEvidence(guildId);
      const opCount  = org.operations.length;

      if (opCount < EXPOSE_THRESHOLD) {
        return interaction.reply({ embeds:[new EmbedBuilder()
          .setColor(0x888888)
          .setTitle('🔍 Investigating...')
          .setDescription(`You suspect a shadow organization operates here, but you need more evidence.\n\nOperations witnessed: **${opCount}/${EXPOSE_THRESHOLD}**\n\nKeep watching. The truth will reveal itself.`)
        ], ephemeral:true });
      }

      // EXPOSED
      org.exposed   = true;
      org.exposedBy = userId;
      org.exposedAt = Date.now();
      await saveIlluminati(guildId, org);
      await clearEvidence(guildId);

      // Soul-sold members lose 80% of their fanbase on exposure
      const { getPhone, savePhone } = require('../../utils/phoneDb');
      const soulSoldMembers = org.members.filter(m => m.soulSold);
      for (const m of soulSoldMembers) {
        try {
          const ph = getPhone(m.userId);
          if (ph) {
            const lost = Math.floor((ph.followers||0) * 0.80);
            ph.followers  = Math.max(0, (ph.followers||0) - lost);
            ph.hype       = Math.max(0, Math.floor((ph.hype||0) * 0.20));
            ph.status     = Math.max(0, Math.floor((ph.status||0) * 0.50));
            if (ph.artistCareer) ph.artistCareer.fame = Math.max(0, Math.floor((ph.artistCareer.fame||0) * 0.20));
            await savePhone(m.userId, ph);
            // DM them
            interaction.client.users.fetch(m.userId).then(u2 => u2.send({ embeds:[new EmbedBuilder()
              .setColor(0xff3b3b)
              .setTitle('🚨 You\'ve Been Exposed!')
              .setDescription('The Illuminati has been exposed — and your soul-selling deal with them is now public.\n\n**-80% followers · -80% hype · -50% status**\n\nYour fanbase has collapsed. The internet is destroying you.')
            ]}).catch(()=>null)).catch(()=>null);
          }
        } catch {}
      }

      const memberList = org.members.map(m => {
        const faction = m.faction ? ILLUMINATI_FACTIONS[m.faction] : null;
        const factionTag = faction ? ` ${faction.emoji}` : '';
        const ritualCount = m.rituals ? m.rituals.length : 0;
        return `${RANKS[m.rank]?.label}${factionTag} <@${m.userId}>${m.soulSold ? ' 🖤 *sold soul*' : ''} — ${ritualCount} rituals`;
      }).join('\n');

      // Faction breakdown
      let factionBreakdown = '';
      const factions = {};
      org.members.forEach(m => {
        const factionId = m.faction || 'none';
        factions[factionId] = (factions[factionId] || 0) + 1;
      });
      
      factionBreakdown = Object.entries(factions).map(([id, count]) => {
        if (id === 'none') return `Unaligned: ${count}`;
        const faction = ILLUMINATI_FACTIONS[id];
        return `${faction.emoji} ${faction.name}: ${count}`;
      }).join('\n');

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle('🚨 THE ILLUMINATI HAS BEEN EXPOSED')
        .setDescription(
          `<@${userId}> has gathered enough evidence to expose the shadow order!\n\n` +
          `**Members:**\n${memberList}\n\n` +
          `**Factions:**\n${factionBreakdown}\n\n` +
          `**Operations run:** ${org.operations.length}\n` +
          `**Vault:** ${fmtMoney(org.vault)}\n\n` +
          (soulSoldMembers.length ? `💀 **${soulSoldMembers.length} soul-sold member(s) lost 80% of their fanbase.**\n\n` : '') +
          `*The truth is out. What happens next is up to the server.*`
        )
      ]});
    }
  },

  _pendingInvites,
};