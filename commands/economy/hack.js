// ============================================================
// commands/economy/hack.js — /hack
// Steal SSN, credit info, or commit identity fraud
// ============================================================
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, hasAccount } = require('../../utils/db');
const { getOrCreateCredit, saveCredit, adjustScore, getCreditTier } = require('../../utils/creditDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();
const HACK_CD  = new Map(); // userId -> last hack time
const HACK_CD_MS = 30 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hack')
    .setDescription('💻 Hack into someone\'s financial profile — steal SSN, commit identity fraud.')
    .addSubcommand(s => s.setName('ssn').setDescription('Attempt to steal a target\'s SSN')
      .addUserOption(o => o.setName('target').setDescription('Who to hack').setRequired(true)))
    .addSubcommand(s => s.setName('fraud').setDescription('Open a credit card on a stolen SSN')
      .addUserOption(o => o.setName('target').setDescription('Victim').setRequired(true)))
    .addSubcommand(s => s.setName('drain').setDescription('Max out a victim\'s credit card')
      .addUserOption(o => o.setName('target').setDescription('Victim').setRequired(true))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub      = interaction.options.getSubcommand();
    const userId   = interaction.user.id;
    const target   = interaction.options.getUser('target');

    if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't hack yourself.")], ephemeral:true });
    if (target.bot)           return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't hack bots.")], ephemeral:true });

    const now      = Date.now();
    const lastHack = HACK_CD.get(userId) || 0;
    if (now - lastHack < HACK_CD_MS) {
      const mins = Math.ceil((HACK_CD_MS - (now-lastHack))/60000);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`💻 Hack cooldown: **${mins} min** remaining.`)], ephemeral:true });
    }

    const hackerCredit = await getOrCreateCredit(userId);
    const victimCredit = await getOrCreateCredit(target.id);

    // ── SSN HACK ──────────────────────────────────────────────
    if (sub === 'ssn') {
      HACK_CD.set(userId, now);

      // Success chance: 40% base, reduced if victim has identity shield item
      const { getUser, getStore } = require('../../utils/db');
      const victimUser  = getUser(target.id);
      const hasShield   = (victimUser?.inventory||[]).includes('identity_shield');
      const successRate = hasShield ? 0.15 : 0.45;
      const success     = Math.random() < successRate;

      if (!success) {
        // Alert victim if they have identity shield
        if (hasShield) {
          target.send({ embeds:[new EmbedBuilder().setColor(0xff8800)
            .setTitle('🛡️ Hack Attempt Blocked!')
            .setDescription(`Your **Identity Shield** blocked a hack attempt on your SSN.\n\nStay vigilant.`)
          ]}).catch(()=>{});
        }
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setTitle('💻 Hack Failed')
          .setDescription(`Couldn't breach <@${target.id}>'s security.${hasShield ? '\n\n🛡️ They had an Identity Shield active.' : ''}`)
        ], ephemeral:true });
      }

      // Steal SSN
      const fragments = hackerCredit.ssnStolen || {};
      fragments[target.id] = { ssn:victimCredit.ssn, score:victimCredit.score, at:Date.now() };
      hackerCredit.ssnStolen = fragments;
      await saveCredit(userId, hackerCredit);

      // Add heat
      try { const { addHeat } = require('../../utils/gangDb'); await addHeat(userId, 20, 'identity hack'); } catch {}

      // Victim gets subtle DM (not immediate — delayed to simulate real identity theft)
      setTimeout(() => {
        target.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
          .setTitle('⚠️ Suspicious Activity Detected')
          .setDescription('Your financial monitoring service detected unusual activity on your profile.\n\nCheck your credit with `/credit check` immediately.\n\n*You may be a victim of identity theft.*')
        ]}).catch(()=>{});
      }, 5 * 60 * 1000); // 5 minute delay

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('💻 Hack Successful')
        .setDescription(`Breached <@${target.id}>'s financial profile.\n\n🪪 SSN: \`${victimCredit.ssn}\`\n📊 Score: **${victimCredit.score}** (${getCreditTier(victimCredit.score).label})\n\nUse \`/hack fraud\` to open a card on their SSN, or \`/hack drain\` to max out their card.`)
      ], ephemeral:true });
    }

    // ── FRAUD (open card on stolen SSN) ───────────────────────
    if (sub === 'fraud') {
      const stolen = hackerCredit.ssnStolen?.[target.id];
      if (!stolen) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You don't have <@${target.id}>'s SSN. Use \`/hack ssn\` first.`)
      ], ephemeral:true });

      if (victimCredit.frozen) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`<@${target.id}>'s credit is **frozen**. Fraud not possible.`)
      ], ephemeral:true });

      const tier   = getCreditTier(victimCredit.score);
      if (!tier.card) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`<@${target.id}>'s score (${victimCredit.score}) is too low — no card available to open.`)
      ], ephemeral:true });

      // Open a fraudulent card on victim's SSN
      const { getOrCreateUser, saveUser: su } = require('../../utils/db');
      const victimUser  = getOrCreateUser(target.id);
      const fraudLimit  = Math.floor((victimUser.bank||0) * (tier.limitPct||0.2) * 0.5); // half normal limit
      const fraudAmount = Math.floor(fraudLimit * (0.5 + Math.random() * 0.5)); // spend 50-100%

      const hacker = getOrCreateUser(userId);
      hacker.wallet += fraudAmount;
      victimCredit.balance = (victimCredit.balance||0) + fraudAmount;
      victimCredit.limit   = Math.max(victimCredit.limit||0, fraudLimit);
      if (!victimCredit.card) victimCredit.card = tier.card;

      // Credit score hit for victim
      await adjustScore(target.id, -45, 'Identity fraud — fraudulent card opened');
      su(userId, hacker);
      await saveCredit(target.id, victimCredit);
      HACK_CD.set(userId, now);

      // Add heat to hacker
      try { const { addHeat } = require('../../utils/gangDb'); await addHeat(userId, 35, 'identity fraud'); } catch {}

      // Immediate DM to victim
      target.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
        .setTitle('🚨 Fraudulent Account Opened!')
        .setDescription(`A credit card was opened on your SSN without your authorization.\n\n💳 Fraudulent charges: **${fmtMoney(fraudAmount)}**\n📊 Credit score penalty: **-45 points**\n\nFreeze your credit immediately with \`/credit freeze\`.`)
      ]}).catch(()=>{});

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('💳 Fraud Successful')
        .setDescription(`Opened a ${tier.card} on <@${target.id}>'s SSN.\n\n💰 Stolen: **${fmtMoney(fraudAmount)}** → your wallet\n📊 Their score: **-45 points**\n\n+35 heat added to your record.`)
      ], ephemeral:true });
    }

    // ── DRAIN (max out existing card) ─────────────────────────
    if (sub === 'drain') {
      const stolen = hackerCredit.ssnStolen?.[target.id];
      if (!stolen) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You don't have <@${target.id}>'s SSN. Use \`/hack ssn\` first.`)
      ], ephemeral:true });
      if (!victimCredit.card) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`<@${target.id}> has no credit card to drain.`)
      ], ephemeral:true });

      const avail = (victimCredit.limit||0) - (victimCredit.balance||0);
      if (avail < 100) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`<@${target.id}>'s card is already near its limit.`)
      ], ephemeral:true });

      const drained = avail;
      const hacker  = getOrCreateUser(userId);
      hacker.wallet += drained;
      victimCredit.balance += drained;
      await adjustScore(target.id, -25, 'Card maxed by identity theft');
      saveUser(userId, hacker);
      await saveCredit(target.id, victimCredit);
      HACK_CD.set(userId, now);

      try { const { addHeat } = require('../../utils/gangDb'); await addHeat(userId, 25, 'credit card drain'); } catch {}

      target.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
        .setTitle('🚨 Card Drained!')
        .setDescription(`Your credit card was maxed out by an unauthorized party.\n\n💸 Amount: **${fmtMoney(drained)}**\n📊 Score: **-25 points**`)
      ]}).catch(()=>{});

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('💳 Card Drained')
        .setDescription(`Drained **${fmtMoney(drained)}** from <@${target.id}>'s card.\n\n💰 Added to your wallet.\n📊 Their score: **-25 points**`)
      ], ephemeral:true });
    }
  },
};
