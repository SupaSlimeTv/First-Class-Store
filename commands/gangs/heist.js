// commands/gangs/heist.js — /heist
// Gang heists — plan, recruit crew, execute for big payouts
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser, getConfig } = require('../../utils/db');
const { getGangByMember, getGang, saveGang } = require('../../utils/gangDb');
const { addHeat, checkPoliceRaid, isJailed, getJailTimeLeft } = require('../../utils/police');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();
const HEIST_COLOR = 0x2c2c2c;

const HEIST_TYPES = {
  bank_vault: {
    name: '🏦 Bank Vault', minCrew:3, maxCrew:6,
    basePayout: 500000, successBase: 40,
    duration: 45, // seconds for execute phase
    desc: 'Hit the downtown vault. High risk, massive payout.',
    roles: ['Driver','Hacker','Gunman','Lookout','Explosives','Inside Man'],
  },
  armored_truck: {
    name: '🚛 Armored Truck', minCrew:2, maxCrew:4,
    basePayout: 150000, successBase: 55,
    duration: 30,
    desc: 'Intercept a cash transport. Quick hit.',
    roles: ['Driver','Gunman','Lookout','Blocker'],
  },
  casino_heist: {
    name: '🎰 Casino Heist', minCrew:4, maxCrew:6,
    basePayout: 750000, successBase: 35,
    duration: 60,
    desc: 'Rob the casino floor and back office. The big score.',
    roles: ['Driver','Hacker','Gunman','Lookout','Con Artist','Inside Man'],
  },
  jewelry_store: {
    name: '💎 Jewelry Store', minCrew:2, maxCrew:3,
    basePayout: 80000, successBase: 65,
    duration: 20,
    desc: 'Smash and grab. Fast and simple.',
    roles: ['Driver','Gunman','Lookout'],
  },
  crypto_exchange: {
    name: '💻 Crypto Exchange', minCrew:2, maxCrew:4,
    basePayout: 300000, successBase: 50,
    duration: 40,
    desc: 'Digital heist — drain the exchange servers.',
    roles: ['Hacker','Hacker','Lookout','Driver'],
  },
};

// Active heist lobbies: heistId -> { type, leaderId, gangId, crew, started, guildId }
const _activeHeists = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('heist')
    .setDescription('Plan and execute gang heists for massive payouts')
    .addSubcommand(s => s.setName('plan')
      .setDescription('Plan a heist and open recruitment for your gang')
      .addStringOption(o => o.setName('type').setDescription('Heist type').setRequired(true)
        .addChoices(
          { name:'🏦 Bank Vault — $500k base (3-6 crew)', value:'bank_vault' },
          { name:'🚛 Armored Truck — $150k base (2-4 crew)', value:'armored_truck' },
          { name:'🎰 Casino Heist — $750k base (4-6 crew)', value:'casino_heist' },
          { name:'💎 Jewelry Store — $80k base (2-3 crew)', value:'jewelry_store' },
          { name:'💻 Crypto Exchange — $300k base (2-4 crew)', value:'crypto_exchange' },
        )))
    .addSubcommand(s => s.setName('status').setDescription('Check your active heist status')),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const guild  = interaction.guild;
    const config = getConfig(interaction.guildId);

    if (isJailed(userId)) {
      const mins = getJailTimeLeft(userId);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`🚔 You're in jail. Release in **${mins}m**. Can't plan heists from a cell.`)
      ], ephemeral:true });
    }

    const gang = getGangByMember(userId);
    if (!gang) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription('You need to be in a gang to run heists. Join or create one with `/gang`.')
    ], ephemeral:true });

    // ── STATUS ────────────────────────────────────────────────
    if (sub === 'status') {
      const active = [..._activeHeists.values()].find(h => h.gangId === gang.id);
      if (!active) return interaction.reply({ embeds:[new EmbedBuilder().setColor(HEIST_COLOR)
        .setDescription('No active heist. Start one with `/heist plan`.')
      ], ephemeral:true });

      const type = HEIST_TYPES[active.type];
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(HEIST_COLOR)
        .setTitle(`${type.name} — Status`)
        .addFields(
          { name:'👥 Crew', value:active.crew.map((c,i) => `${type.roles[i]||'Crew'}: <@${c}>`).join('\n') || 'None', inline:false },
          { name:'📊 Min Crew', value:`${type.minCrew}`, inline:true },
          { name:'💰 Base Payout', value:fmtMoney(type.basePayout), inline:true },
          { name:'🎯 Base Success', value:`${type.successBase}%`, inline:true },
        )
      ], ephemeral:true });
    }

    // ── PLAN ──────────────────────────────────────────────────
    const heistType = interaction.options.getString('type');
    const type = HEIST_TYPES[heistType];

    // Check no active heist for this gang
    const existing = [..._activeHeists.values()].find(h => h.gangId === gang.id);
    if (existing) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription('Your gang already has an active heist in progress. Check `/heist status`.')
    ], ephemeral:true });

    // Check leader/officer role
    const myMember = gang.members?.find(m => m.userId === userId);
    const isLeader = gang.leaderId === userId || ['boss','underboss','capo'].includes(myMember?.rank);
    if (!isLeader) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription('Only gang leaders and officers can plan heists.')
    ], ephemeral:true });

    const heistId = `${gang.id}_${Date.now()}`;
    const crew = [userId]; // Leader auto-joins
    _activeHeists.set(heistId, {
      id: heistId, type: heistType, leaderId: userId,
      gangId: gang.id, guildId: interaction.guildId,
      crew, started: Date.now(),
    });

    // Build join embed
    const buildEmbed = () => new EmbedBuilder()
      .setColor(HEIST_COLOR)
      .setTitle(`${type.name} — Crew Recruitment`)
      .setDescription(
        `**${interaction.user.username}** is planning a **${type.name}**!\n\n` +
        `📋 *${type.desc}*\n\n` +
        `💰 Base Payout: **${fmtMoney(type.basePayout)}** split among crew\n` +
        `🎯 Base Success: **${type.successBase}%**\n` +
        `👥 Need: **${type.minCrew}–${type.maxCrew}** crew members\n\n` +
        `**Roles needed:** ${type.roles.slice(0, type.maxCrew).join(' · ')}\n\n` +
        `⚠️ Failed heist = jail time + heat for all crew.`
      )
      .addFields({ name:`👥 Crew (${crew.length}/${type.maxCrew})`, value:crew.map((id,i) => `${type.roles[i]||'Crew'}: <@${id}>`).join('\n') })
      .setFooter({ text:`120 second join window · Gang members only · Leader can start early` });

    const joinRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`heist_join_${heistId}`).setLabel('🔫 Join Heist').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`heist_abort_${heistId}`).setLabel('❌ Abort').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`heist_execute_${heistId}`).setLabel('▶ Execute').setStyle(ButtonStyle.Success),
    );

    const msg = await interaction.reply({ embeds:[buildEmbed()], components:[joinRow], fetchReply:true });

    const collector = msg.createMessageComponentCollector({ time: 120_000 });

    collector.on('collect', async btn => {
      const btnUserId = btn.user.id;
      const heist = _activeHeists.get(heistId);
      if (!heist) return btn.reply({ content:'Heist expired.', ephemeral:true });

      if (btn.customId === `heist_join_${heistId}`) {
        // Must be in the same gang
        const btnGang = getGangByMember(btnUserId);
        if (!btnGang || btnGang.id !== gang.id) {
          return btn.reply({ content:'You must be in the same gang to join this heist.', ephemeral:true });
        }
        if (crew.includes(btnUserId)) {
          return btn.reply({ content:'You already joined.', ephemeral:true });
        }
        if (isJailed(btnUserId)) {
          return btn.reply({ content:`You're in jail — can't join a heist.`, ephemeral:true });
        }
        if (crew.length >= type.maxCrew) {
          return btn.reply({ content:`Crew full (${type.maxCrew} max).`, ephemeral:true });
        }
        crew.push(btnUserId);
        await btn.update({ embeds:[buildEmbed()], components:[joinRow] });
      }

      if (btn.customId === `heist_abort_${heistId}`) {
        if (btnUserId !== userId) return btn.reply({ content:'Only the leader can abort.', ephemeral:true });
        _activeHeists.delete(heistId);
        collector.stop('aborted');
        await btn.update({ embeds:[new EmbedBuilder().setColor(0x888888)
          .setTitle(`${type.name} — Aborted`)
          .setDescription('Heist cancelled by the leader.')
        ], components:[] });
      }

      if (btn.customId === `heist_execute_${heistId}`) {
        if (btnUserId !== userId) return btn.reply({ content:'Only the leader can execute.', ephemeral:true });
        if (crew.length < type.minCrew) {
          return btn.reply({ content:`Need at least ${type.minCrew} crew members. Have ${crew.length}.`, ephemeral:true });
        }
        collector.stop('execute');
        await executeHeist(btn, heist, type, crew, gang, config);
      }
    });

    collector.on('end', async (_, reason) => {
      const heist = _activeHeists.get(heistId);
      if (!heist) return;
      if (reason === 'execute' || reason === 'aborted') return;

      // Timeout — auto-execute if enough crew, else abort
      if (crew.length >= type.minCrew) {
        _activeHeists.delete(heistId);
        const chan = await guild.channels.fetch(msg.channelId).catch(()=>null);
        if (chan) {
          await executeHeistInChannel(chan, heist, type, crew, gang, config, interaction.client);
        }
      } else {
        _activeHeists.delete(heistId);
        msg.edit({ embeds:[new EmbedBuilder().setColor(0x888888)
          .setTitle(`${type.name} — Cancelled`)
          .setDescription(`Not enough crew (need ${type.minCrew}, got ${crew.length}). Heist cancelled.`)
        ], components:[] }).catch(()=>null);
      }
    });
  },
};

async function executeHeist(interaction, heist, type, crew, gang, config) {
  _activeHeists.delete(heist.id);

  await interaction.update({ embeds:[new EmbedBuilder().setColor(0xff6b00)
    .setTitle(`${type.name} — IN PROGRESS`)
    .setDescription(`🚨 The heist is live!\n\n${crew.map((id,i)=>`${type.roles[i]||'Crew'}: <@${id}>`).join('\n')}\n\n*Executing... stand by.*`)
  ], components:[] });

  await new Promise(r => setTimeout(r, 3000)); // dramatic pause

  await resolveHeist(interaction.message.channel, heist, type, crew, gang, config, interaction.client);
}

async function executeHeistInChannel(channel, heist, type, crew, gang, config, client) {
  await channel.send({ embeds:[new EmbedBuilder().setColor(0xff6b00)
    .setTitle(`${type.name} — AUTO-EXECUTING`)
    .setDescription(`Time ran out but crew was ready. Executing with ${crew.length} members.\n\n${crew.map((id,i)=>`${type.roles[i]||'Crew'}: <@${id}>`).join('\n')}`)
  ]});
  await new Promise(r => setTimeout(r, 2000));
  await resolveHeist(channel, heist, type, crew, gang, config, client);
}

async function resolveHeist(channel, heist, type, crew, gang, config, client) {
  const { getOrCreateUser, saveUser } = require('../../utils/db');

  // Success calculation — crew size bonus, gang upgrades
  const crewBonus   = (crew.length - type.minCrew) * 5; // +5% per extra member
  const gangLevel   = gang.level || 1;
  const gangBonus   = Math.min(20, gangLevel * 2);
  const successRate = Math.min(90, type.successBase + crewBonus + gangBonus);
  const success     = Math.random() * 100 < successRate;

  if (success) {
    // Scale payout with crew and gang level
    const payout    = Math.floor(type.basePayout * (1 + gangBonus/100) * (0.8 + Math.random() * 0.4));
    const perPerson = Math.floor(payout / crew.length);

    for (const uid of crew) {
      const u = getOrCreateUser(uid);
      u.wallet += perPerson;
      saveUser(uid, u);
      await addHeat(uid, 25, 'heist');
    }

    // Gang XP
    gang.xp = (gang.xp||0) + 500;
    await saveGang(gang.id, gang);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`✅ ${type.name} — SUCCESS!`)
      .setDescription(
        `The crew pulled it off!\n\n` +
        `💰 **Total Take: ${fmtMoney(payout)}**\n` +
        `💵 **Per Person: ${fmtMoney(perPerson)}**\n\n` +
        crew.map((id,i) => `${type.roles[i]||'Crew'}: <@${id}> +${fmtMoney(perPerson)}`).join('\n') +
        `\n\n⚠️ All crew gained **+25 heat**. Lay low.`
      )
      .setFooter({ text:`Success rate was ${successRate}% · Gang +500 XP` });

    await channel.send({ embeds:[embed] });

  } else {
    // Failed — jail everyone
    const jailMins = 10 + Math.floor(Math.random() * 10);

    for (const uid of crew) {
      await addHeat(uid, 40, 'failed heist');
      await checkPoliceRaid(uid, client, config.prisonChannelId || config.purgeChannelId);
    }

    const embed = new EmbedBuilder()
      .setColor(0xff3b3b)
      .setTitle(`❌ ${type.name} — BUSTED!`)
      .setDescription(
        `The crew got caught!\n\n` +
        crew.map((id,i) => `${type.roles[i]||'Crew'}: <@${id}>`).join('\n') +
        `\n\n🚔 All crew: **+40 heat** · Police raid check triggered\n` +
        `*Everyone needs to check \`/myheat\` and stay low.*`
      )
      .setFooter({ text:`Success rate was ${successRate}%` });

    await channel.send({ embeds:[embed] });
  }
}
