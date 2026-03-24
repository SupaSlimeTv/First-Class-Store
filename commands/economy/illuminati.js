// ============================================================
// commands/economy/illuminati.js — /illuminati
// The shadow organization. Per-server, rank carries cross-server.
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

const fmtMoney = n => '$' + Math.round(n).toLocaleString();
const ILLUM_COLOR = 0x1a1a2e;
const GOLD_COLOR  = 0xf5c518;

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
    .addSubcommand(s => s.setName('vault').setDescription('Contribute to or view the vault')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to contribute (leave blank to view)').setRequired(false).setMinValue(1)))
    .addSubcommand(s => s.setName('promote').setDescription('Promote a member (Grandmaster only)')
      .addUserOption(o => o.setName('user').setDescription('Member to promote').setRequired(true)))
    .addSubcommand(s => s.setName('excommunicate').setDescription('Exile a member (requires Elder vote)')
      .addUserOption(o => o.setName('user').setDescription('Member to exile').setRequired(true)))
    .addSubcommand(s => s.setName('operate').setDescription('Execute an operation using vault funds')
      .addStringOption(o => o.setName('operation').setDescription('Operation to run').setRequired(true)
        .addChoices(
          { name:'🕵️ Shadow Rob — anonymously drain 10% from a user',         value:'shadow_rob' },
          { name:'📡 Intel Report — full profile on any user',                  value:'intel' },
          { name:'🛡️ Protection Racket — demand tribute from a gang',          value:'protection' },
          { name:'📊 Market Manipulation — pump or dump a coin for 30min',     value:'market_manip' },
          { name:'💸 Tribute Collection — collect owed tribute from gangs',    value:'collect_tribute' },
          { name:'📸 Blackmail — control a Celebrity+ through leverage',           value:'blackmail' },
          { name:'🎵 Force Sign — sign a Celebrity+ to an Illuminati label',       value:'sign_artist' },
        ))
      .addUserOption(o => o.setName('target').setDescription('Target user (for rob/intel/protection)').setRequired(false))
      .addStringOption(o => o.setName('coin').setDescription('Coin ticker (for market manipulation)').setRequired(false))
      .addStringOption(o => o.setName('direction').setDescription('Pump or dump?').setRequired(false)
        .addChoices({ name:'📈 Pump', value:'pump' }, { name:'📉 Dump', value:'dump' })))
    .addSubcommand(s => s.setName('expose').setDescription('Attempt to expose the Illuminati publicly')),

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
      org.members.push({ userId, rank:'grandmaster', joinedAt:Date.now(), contribution:INITIATION_FEE, guildId });
      org.vault += INITIATION_FEE;
      await saveIlluminati(guildId, org);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(GOLD_COLOR)
        .setTitle('🔺 The Illuminati Has Been Founded')
        .setDescription(`<@${userId}> has established the shadow order.\n\nThe **${fmtMoney(INITIATION_FEE)}** initiation fee has been deposited into the vault.\n\nYou are the **⚡ Grandmaster**. Choose your Elders wisely.`)
        .setFooter({ text:'Membership is invite-only. Max 13 members.' })
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
        memberList = org.members.map(m =>
          `${RANKS[m.rank]?.label||'🔺'} <@${m.userId}> — contributed ${fmtMoney(m.contribution||0)}`
        ).join('\n') || 'None';
      } else {
        memberList = `**${org.members.length}** members *(identities hidden)*`;
      }

      const embed = new EmbedBuilder()
        .setColor(isMem ? GOLD_COLOR : ILLUM_COLOR)
        .setTitle(`🔺 The Illuminati${exposed ? ' *(EXPOSED)*' : ''}`)
        .addFields(
          { name:'👥 Members', value:memberList, inline:false },
          { name:'🏦 Vault',   value:isMem ? fmtMoney(org.vault) : '***', inline:true },
          { name:'📊 Ops Run', value:`${(org.operations||[]).length}`, inline:true },
        );

      if (myRank) embed.setDescription(`Your rank: **${RANKS[myRank.rank]?.label}**`);
      if (exposed) embed.setFooter({ text:'The Illuminati has been exposed!' });

      return interaction.reply({ embeds:[embed], ephemeral: !exposed });
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

      const issues = await checkEligibility(target.id, guildId);
      if (issues.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('🔺 Target Not Eligible')
        .setDescription(`<@${target.id}> doesn't qualify:\n${issues.map(i=>`• ${i}`).join('\n')}`)
      ], ephemeral:true });

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
          .setDescription(`An emissary of the **Illuminati** has extended an invitation to you in **${interaction.guild.name}**.\n\nAccepting costs **${fmtMoney(INITIATION_FEE)}** — your initiation fee into the vault.\n\n*The order is secret. Membership has its privileges.*\n\n⏱️ Expires in 10 minutes.`)
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
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(GOLD_COLOR)
          .setTitle('🏦 Illuminati Vault')
          .setDescription(`Current balance: **${fmtMoney(org.vault)}**\n\nContribute with \`/illuminati vault amount:\``)
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
        await addEvidence(guildId, `op_${Date.now()}`);

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

        const victim  = getUser(target.id);
        const home    = getHome(target.id);
        const phone   = getPhone(target.id);
        const rec     = getPoliceRecord(target.id);
        const biz     = getBusiness(target.id);
        const gang    = getGangByMember(target.id);
        const store   = getStore(guildId);
        const stash   = (home?.stash||[]).map(id => store.items.find(i=>i.id===id)?.name||id);

        org.vault -= COST;
        org.operations.push({ type:'intel', target:target.id, by:userId, at:Date.now() });
        await saveIlluminati(guildId, org);

        return interaction.reply({ embeds:[new EmbedBuilder()
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
          .setFooter({ text:'Intel expires in 24hrs. Do not share.' })
        ], ephemeral:true });
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
        await addEvidence(guildId, `op_${Date.now()}`);

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
        await addEvidence(guildId, `op_${Date.now()}`);

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
            // Can't pay — shadow rob them
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
    }

    // ── EXPOSE ────────────────────────────────────────────────
    if (sub === 'expose') {
      const org = getIlluminati(guildId);
      if (!org) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('No Illuminati in this server.')], ephemeral:true });
      if (org.exposed) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('The Illuminati has already been exposed!')], ephemeral:true });
      if (isMember(guildId, userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You cannot expose an organization you belong to.')], ephemeral:true });

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

      const memberList = org.members.map(m => `${RANKS[m.rank]?.label} <@${m.userId}>`).join('\n');

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle('🚨 THE ILLUMINATI HAS BEEN EXPOSED')
        .setDescription(`<@${userId}> has gathered enough evidence to expose the shadow order!\n\n**Members:**\n${memberList}\n\n**Operations run:** ${org.operations.length}\n**Vault:** ${fmtMoney(org.vault)}\n\n*The truth is out. What happens next is up to the server.*`)
      ]});
    }
  },

  _pendingInvites,
};
