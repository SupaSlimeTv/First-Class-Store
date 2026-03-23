// ============================================================
// commands/economy/police.js — /police
// Full police system: search, arrest, warrant, raid, bribe
// ============================================================

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser, getStore, getConfig } = require('../../utils/db');
const { isOfficer, getOfficer, getOfficers, hireOfficer, fireOfficer, updateOfficer,
        getWarrants, hasActiveWarrant, issueWarrant, clearWarrant,
        getTreasury } = require('../../utils/policeDb');
const { getHome, hasSecurityCamera, hasPanicRoom } = require('../../utils/homeDb');
const { getGangByMember } = require('../../utils/gangDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();
const SEARCH_CD = 30 * 60 * 1000; // 30 min per officer per target
const BRIBE_CD  = 60 * 60 * 1000; // 1hr bribe cooldown

module.exports = {
  data: new SlashCommandBuilder()
    .setName('police')
    .setDescription('Police system — search, arrest, warrants, and more.')
    .addSubcommand(s => s.setName('badge').setDescription('View your badge and stats'))
    .addSubcommand(s => s.setName('search').setDescription('Search a user for illegal items (requires warrant or admin)')
      .addUserOption(o => o.setName('user').setDescription('Who to search').setRequired(true)))
    .addSubcommand(s => s.setName('arrest').setDescription('Arrest a user (requires warrant)')
      .addUserOption(o => o.setName('user').setDescription('Who to arrest').setRequired(true))
      .addIntegerOption(o => o.setName('minutes').setDescription('Jail time in minutes').setRequired(false).setMinValue(1).setMaxValue(120)))
    .addSubcommand(s => s.setName('warrant').setDescription('Issue a warrant for a user')
      .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for warrant').setRequired(true).setMaxLength(200)))
    .addSubcommand(s => s.setName('warrants').setDescription('View all active warrants'))
    .addSubcommand(s => s.setName('raid').setDescription('Call a police raid to break up an active gang war (requires 3+ officers on duty)')
      .addStringOption(o => o.setName('gang').setDescription('Gang name to raid').setRequired(true)))
    .addSubcommand(s => s.setName('tip').setDescription('Anonymously tip off police about a user ($500 fee — false tips lose it)')
      .addUserOption(o => o.setName('user').setDescription('Who to report').setRequired(true)))
    .addSubcommand(s => s.setName('bribe').setDescription('Bribe an officer to look the other way')
      .addUserOption(o => o.setName('officer').setDescription('Officer to bribe').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Bribe amount').setRequired(true).setMinValue(500))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub     = interaction.options.getSubcommand();
    const userId  = interaction.user.id;
    const guildId = interaction.guildId;
    const config  = getConfig(guildId);

    // Check if user is an officer for officer-only commands
    const officerCmds = ['search','arrest','warrant','warrants','raid'];
    if (officerCmds.includes(sub)) {
      const policeRoleId = config.policeRoleId;
      const member       = interaction.member;
      const hasRole      = policeRoleId && member.roles.cache.has(policeRoleId);
      const isAdmin      = member.permissions.has('Administrator') || member.permissions.has('ManageGuild');
      if (!hasRole && !isAdmin) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('🚔 Officers Only')
        .setDescription('You need to be a police officer to use this command.\n\nContact an admin to get hired.')
      ], ephemeral:true });
    }

    // ── BADGE ─────────────────────────────────────────────────
    if (sub === 'badge') {
      const officer  = getOfficer(guildId, userId);
      const warrants = getWarrants(guildId);
      const treasury = getTreasury(guildId);
      if (!officer) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription("You're not a police officer in this server.")
      ], ephemeral:true });

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🚔 Officer Badge')
        .addFields(
          { name:'👤 Officer',          value:`<@${userId}>`,                            inline:true },
          { name:'⭐ Credibility',       value:`${officer.credibility||100}/100`,         inline:true },
          { name:'💰 Salary',           value:officer.salary ? fmtMoney(officer.salary)+'/tick' : 'Unpaid', inline:true },
          { name:'📋 Active Warrants',  value:`${warrants.length}`,                      inline:true },
          { name:'🏦 Treasury',         value:fmtMoney(treasury.balance||0),             inline:true },
          { name:'🤝 Bribes Accepted',  value:`${officer.bribesAccepted||0}`,            inline:true },
        )
      ], ephemeral:true });
    }

    // ── WARRANTS LIST ─────────────────────────────────────────
    if (sub === 'warrants') {
      const warrants = getWarrants(guildId);
      if (!warrants.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888)
        .setTitle('📋 Active Warrants')
        .setDescription('No active warrants.')
      ]});

      const lines = warrants.map(w => {
        const left = Math.ceil((w.expiresAt - Date.now()) / 60000);
        return `<@${w.targetId}> — *${w.reason}*\n⏱️ ${left}min remaining · Type: ${w.type}`;
      }).join('\n\n');

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle(`📋 Active Warrants (${warrants.length})`)
        .setDescription(lines)
      ]});
    }

    // ── ISSUE WARRANT ─────────────────────────────────────────
    if (sub === 'warrant') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't warrant yourself.")], ephemeral:true });

      // Can't issue warrant on same person twice in a row
      const officer = getOfficer(guildId, userId);
      if (officer?.lastWarrantedId === target.id) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You already issued the last warrant against <@${target.id}>. Issue one on someone else first.`)
      ], ephemeral:true });

      await issueWarrant(guildId, target.id, userId, reason, 'manual');
      await updateOfficer(guildId, userId, { lastWarrantedId: target.id });

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xff8800)
        .setTitle('📋 Warrant Issued')
        .setDescription(`Warrant issued for <@${target.id}>.\n\n**Reason:** ${reason}\n\n⏱️ Expires in 2 hours.`)
      ]});
    }

    // ── SEARCH ────────────────────────────────────────────────
    if (sub === 'search') {
      const target  = interaction.options.getUser('user');
      if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't search yourself.")], ephemeral:true });

      // Cooldown — can't search same person twice in 30min
      const officer = getOfficer(guildId, userId);
      const lastSearch = (officer?.searchCooldowns||{})[target.id] || 0;
      if (Date.now() - lastSearch < SEARCH_CD) {
        const mins = Math.ceil((SEARCH_CD - (Date.now()-lastSearch)) / 60000);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`You searched <@${target.id}> recently. Wait **${mins}m** before searching them again.`)
        ], ephemeral:true });
      }

      // Check warrant — gang leaders need higher heat threshold
      const targetGang   = getGangByMember(target.id);
      const isGangLeader = targetGang?.leaderId === target.id;

      // ── PAYROLL CHECK ─────────────────────────────────────────
      // If target is in a gang — check if THIS officer is on that gang's payroll
      if (targetGang) {
        const gangPayrolls = targetGang.payrolls || {};
        const key = `${targetGang.id}:${userId}`;
        const onPayroll = !!gangPayrolls[key];

        if (onPayroll) {
          // This officer is bought — they cannot search this gang member
          return interaction.reply({ embeds:[new EmbedBuilder()
            .setColor(0xf5c518)
            .setTitle('⚠️ Conflict of Interest')
            .setDescription(`You have a standing arrangement with **${targetGang.name}**. You cannot search their members.\n\nCut the deal first if you want to proceed.`)
          ], ephemeral:true });
        }

        // Not on payroll — gang's payroll level gives members 30% evasion chance
        const hasPayrollProtection = targetGang.police_payroll && Object.keys(gangPayrolls).length > 0;
        if (hasPayrollProtection && Math.random() < 0.30) {
          // Target evades — update cooldown so officer can't just spam
          const cds = { ...(officer?.searchCooldowns||{}), [target.id]: Date.now() };
          await updateOfficer(guildId, userId, { searchCooldowns: cds });
          return interaction.reply({ embeds:[new EmbedBuilder()
            .setColor(0x888888)
            .setTitle('🔍 Search Inconclusive')
            .setDescription(`<@${target.id}> was uncooperative and the search couldn't be completed.\n\n*${targetGang.name} has connections — some things don't get found.*`)
          ]});
        }
      }
      // ── END PAYROLL CHECK ─────────────────────────────────────

      if (!hasActiveWarrant(guildId, target.id) && !interaction.member.permissions.has('Administrator')) {
        if (isGangLeader) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setTitle('⚠️ Warrant Required')
          .setDescription(`<@${target.id}> is a gang leader. You need an active warrant to search them.`)
        ], ephemeral:true });
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setTitle('📋 Warrant Required')
          .setDescription(`You need an active warrant to search <@${target.id}>. Use \`/police warrant\` to issue one.`)
        ], ephemeral:true });
      }

      // Check if target has security camera (warns them)
      const targetHome = getHome(target.id);
      if (targetHome && hasSecurityCamera(targetHome)) {
        target.send({ embeds:[new EmbedBuilder().setColor(0xff8800)
          .setTitle('📷 Security Alert!')
          .setDescription(`🚨 Your security camera detected **${interaction.user.username}** attempting to search you!`)
        ]}).catch(()=>{});
      }

      // Update search cooldown
      const cds = { ...(officer?.searchCooldowns||{}), [target.id]: Date.now() };
      await updateOfficer(guildId, userId, { searchCooldowns: cds });

      // Perform search
      const targetUser = getOrCreateUser(target.id);
      const store      = getStore(guildId);
      const inventory  = targetUser.inventory || [];

      const illegalItems = inventory.filter(id => {
        const item = store.items.find(i=>i.id===id);
        return item?.isDrug || item?.isWeapon;
      });

      if (!illegalItems.length) {
        // CLEAN — officer loses credibility for false search
        await updateOfficer(guildId, userId, { credibility: Math.max(0, (officer?.credibility||100) - 5) });
        return interaction.reply({ embeds:[new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('🔍 Search Complete — Clean')
          .setDescription(`<@${target.id}> was clean. No illegal items found.\n\n⚠️ -5 officer credibility for unnecessary search.`)
        ]});
      }

      // FOUND ILLEGAL ITEMS — confiscate, jail
      const confiscated = [...illegalItems];
      targetUser.inventory = inventory.filter(id => !illegalItems.includes(id));

      // Officer gets 15% of items' value
      const totalValue = confiscated.reduce((s, id) => {
        const item = store.items.find(i=>i.id===id);
        return s + (item?.price||0);
      }, 0);
      const officerCut = Math.floor(totalValue * 0.15);
      const officerUser = getOrCreateUser(userId);
      officerUser.wallet += officerCut;

      saveUser(target.id, targetUser);
      saveUser(userId, officerUser);
      await clearWarrant(guildId, target.id);
      await updateOfficer(guildId, userId, { credibility: Math.min(100, (officer?.credibility||100) + 10) });

      // Jail the target
      try {
        const { jailUser } = require('../moderation/jail');
        await jailUser(interaction.guild, target.id, 10, 'Caught with illegal items during police search', config, null);
      } catch {}

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle('🚔 Contraband Found!')
        .setDescription(`<@${target.id}> was caught with illegal items!`)
        .addFields(
          { name:'🔍 Items Seized', value:confiscated.map(id=>{ const i=store.items.find(x=>x.id===id); return i?.name||id; }).join(', '), inline:false },
          { name:'💰 Seized Value', value:fmtMoney(totalValue), inline:true },
          { name:'💵 Officer Cut',  value:fmtMoney(officerCut), inline:true },
          { name:'⛓️ Jailed',       value:'10 minutes',         inline:true },
        )
      ]});
    }

    // ── ARREST ────────────────────────────────────────────────
    if (sub === 'arrest') {
      const target  = interaction.options.getUser('user');
      const minutes = interaction.options.getInteger('minutes') || 15;

      if (!hasActiveWarrant(guildId, target.id) && !interaction.member.permissions.has('Administrator')) {
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`<@${target.id}> doesn't have an active warrant. Issue one first with \`/police warrant\`.`)
        ], ephemeral:true });
      }

      // Check if target has panic room
      const targetHome = getHome(target.id);
      if (targetHome && hasPanicRoom(targetHome)) {
        const { saveHome } = require('../../utils/homeDb');
        hasPanicRoom(targetHome); // check
        const { usePanicRoom } = require('../../utils/homeDb');
        if (usePanicRoom(targetHome)) {
          await saveHome(target.id, targetHome);
          await clearWarrant(guildId, target.id);
          target.send({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
            .setTitle('🚨 Panic Room Used!')
            .setDescription(`You escaped arrest! Your panic room saved you — but it's been used up.`)
          ]}).catch(()=>{});
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888)
            .setDescription(`<@${target.id}> escaped via their **Panic Room**! It's been used up.`)
          ]});
        }
      }

      try {
        const { jailUser } = require('../moderation/jail');
        await jailUser(interaction.guild, target.id, minutes, `Arrested by officer ${interaction.user.username}`, config, null);
      } catch {}

      await clearWarrant(guildId, target.id);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle('⛓️ Arrested!')
        .setDescription(`<@${target.id}> has been arrested for **${minutes} minutes**.`)
      ]});
    }

    // ── RAID ──────────────────────────────────────────────────
    if (sub === 'raid') {
      const gangName = interaction.options.getString('gang');

      // Requires 3+ officers
      const officers = getOfficers(guildId);
      if (officers.length < 3) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('🚔 Not Enough Officers')
        .setDescription(`A raid requires **3 or more active officers**. You currently have **${officers.length}**.\n\nAdmin needs to hire more officers via the dashboard.`)
      ], ephemeral:true });

      // Find the gang
      const { getAllGangs } = require('../../utils/gangDb');
      const allGangs = getAllGangs ? getAllGangs() : {};
      const gang = Object.values(allGangs).find(g => g.name?.toLowerCase() === gangName.toLowerCase());
      if (!gang) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Gang **${gangName}** not found.`)
      ], ephemeral:true });

      // Jail the gang leader + arrest all active members
      const jailed = [];
      for (const memberId of (gang.members||[])) {
        try {
          const { jailUser } = require('../moderation/jail');
          await jailUser(interaction.guild, memberId, 5, `Gang raid by police`, config, null);
          jailed.push(`<@${memberId}>`);
        } catch {}
      }

      // Wipe gang heat
      const { getGangByMember, saveGang } = require('../../utils/gangDb');
      gang.heat = 0;
      if (typeof saveGang === 'function') await saveGang(gang.id, gang);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`🚔 Gang Raid — ${gang.name}`)
        .setDescription(`Police raided **${gang.name}**!\n\n${jailed.length} members arrested for 5 minutes.\nGang heat wiped.`)
        .addFields({ name:'⛓️ Arrested', value:jailed.join(', ')||'None online', inline:false })
      ]});
    }

    // ── TIP ───────────────────────────────────────────────────
    if (sub === 'tip') {
      const target = interaction.options.getUser('user');
      const tipper = getOrCreateUser(userId);
      const TIP_COST = 500;

      if (tipper.wallet < TIP_COST) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Tips cost **$${TIP_COST.toLocaleString()}** to prevent spam.`)
      ], ephemeral:true });

      tipper.wallet -= TIP_COST;
      saveUser(userId, tipper);

      // Check if target actually has illegal items
      const targetUser = getOrCreateUser(target.id);
      const store      = getStore(guildId);
      const hasIllegal = (targetUser.inventory||[]).some(id => {
        const item = store.items.find(i=>i.id===id);
        return item?.isDrug || item?.isWeapon;
      });

      if (hasIllegal) {
        // Valid tip — issue auto warrant, refund + bonus
        await issueWarrant(guildId, target.id, userId, `Anonymous tip`, 'tip');
        tipper.wallet += TIP_COST * 2; // refund + bonus
        saveUser(userId, tipper);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setTitle('📞 Tip Filed!')
          .setDescription(`Your tip was valid! A warrant has been issued for <@${target.id}>.\n\n💵 Refunded + bonus: **$${(TIP_COST*2).toLocaleString()}**`)
        ], ephemeral:true });
      } else {
        // False tip — money lost
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setTitle('📞 False Tip')
          .setDescription(`<@${target.id}> came up clean. Your **$${TIP_COST.toLocaleString()}** tip fee is forfeited.`)
        ], ephemeral:true });
      }
    }

    // ── BRIBE ─────────────────────────────────────────────────
    if (sub === 'bribe') {
      const targetOfficer = interaction.options.getUser('officer');
      const amount        = interaction.options.getInteger('amount');
      const briber        = getOrCreateUser(userId);

      if (!isOfficer(guildId, targetOfficer.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`<@${targetOfficer.id}> is not a police officer.`)
      ], ephemeral:true });

      if (briber.wallet < amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You need **${fmtMoney(amount)}** in your wallet.`)
      ], ephemeral:true });

      briber.wallet -= amount;
      saveUser(userId, briber);

      // Send bribe offer to officer as DM
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bribe_accept_${userId}_${amount}`).setLabel(`💰 Accept $${amount.toLocaleString()}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`bribe_decline_${userId}_${amount}`).setLabel('❌ Decline & Report').setStyle(ButtonStyle.Danger),
      );

      try {
        await targetOfficer.send({ embeds:[new EmbedBuilder()
          .setColor(0xf5c518)
          .setTitle('💰 Bribe Offer')
          .setDescription(`**${interaction.user.username}** is offering you **${fmtMoney(amount)}** to look the other way.\n\n⚠️ Accepting will be logged. Decline to stay clean.`)
        ], components:[row] });
      } catch {
        // Can't DM officer — refund
        briber.wallet += amount;
        saveUser(userId, briber);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription("Can't reach that officer via DM. Bribe cancelled, money refunded.")
        ], ephemeral:true });
      }

      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xf5c518)
        .setDescription(`Bribe offer of **${fmtMoney(amount)}** sent to <@${targetOfficer.id}>. Waiting for response...`)
      ], ephemeral:true });
    }
  },
};
