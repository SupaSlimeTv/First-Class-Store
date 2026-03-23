// ============================================================
// commands/economy/bitcoin.js
// Mix hot stolen funds through BTC to clean wallet money
// Risk of getting caught if police investigation is open
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, isBotBanned } = require('../../utils/db');
const { getBtcWallet, saveBtcWallet, MIXER_TIERS } = require('../../utils/bitcoinDb');
const { getPoliceRecord, savePoliceRecord } = require('../../utils/gangDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const { col } = require('../../utils/mongo');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bitcoin')
    .setDescription('Manage your BTC wallet and mix hot funds.')
    .addSubcommand(s => s.setName('wallet').setDescription('Check your BTC hot wallet balance'))
    .addSubcommand(s => s.setName('mix').setDescription('Mix hot funds to clean untraceable money')
      .addStringOption(o => o.setName('speed').setDescription('Mix speed — faster = riskier').setRequired(true)
        .addChoices(
          { name:'🐢 Slow Mix — 4hr delay, 5% fee, low risk',    value:'slow'   },
          { name:'⚡ Normal Mix — 1hr delay, 10% fee',           value:'normal' },
          { name:'🚀 Fast Mix — Instant, 20% fee, high risk',    value:'fast'   },
        ))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to mix (default: all hot funds)').setRequired(false).setMinValue(1))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    if (isBotBanned(interaction.user.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You are silenced.')], ephemeral:true });

    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const btc    = getBtcWallet(userId);

    // ── WALLET ───────────────────────────────────────────────
    if (sub === 'wallet') {
      const queue    = (btc.mixQueue||[]).filter(m => m.completeAt > Date.now());
      const queueAmt = queue.reduce((s,m)=>s+m.amount,0);
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf7931a)
        .setTitle('₿ Bitcoin Wallet')
        .addFields(
          { name:'🔥 Hot Funds',      value:fmtMoney(btc.hotFunds||0),   inline:true },
          { name:'✅ Clean Funds',    value:fmtMoney(btc.cleanFunds||0), inline:true },
          { name:'⏳ In Mixer',       value:fmtMoney(queueAmt),           inline:true },
          { name:'📋 How it works',  value:'Hot funds are stolen money — **do not add to your wallet yet** or police can trace it. Mix first to clean it.',inline:false },
        )
        .setFooter({ text:'Use /bitcoin mix to clean hot funds · /bitcoin collect to move clean funds to wallet' })
      ], ephemeral:true });
    }

    // ── COLLECT ─────────────────────────────────────────────
    if (sub === 'collect') {
      const cleanFunds = btc.cleanFunds || 0;
      const now        = Date.now();
      // Also complete any queued mixes that are ready
      let newClean = 0;
      btc.mixQueue = (btc.mixQueue||[]).filter(m => {
        if (m.completeAt <= now) { newClean += m.amount; return false; }
        return true;
      });
      btc.cleanFunds = cleanFunds + newClean;
      const total = btc.cleanFunds;
      if (total < 1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('No clean funds ready to collect yet. Check `/bitcoin wallet` for your mix queue.')
      ], ephemeral:true });

      const user = getOrCreateUser(userId);
      user.wallet     += total;
      btc.cleanFunds   = 0;
      saveUser(userId, user);
      await saveBtcWallet(userId, btc);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('₿ Funds Collected!')
        .setDescription(`Clean funds moved to your wallet.`)
        .addFields(
          { name:'✅ Collected',   value:fmtMoney(total),         inline:true },
          { name:'💵 New Wallet',  value:fmtMoney(user.wallet),   inline:true },
        )
      ], ephemeral:true });
    }

    // ── MIX ──────────────────────────────────────────────────
    if (sub === 'mix') {
      const speed    = interaction.options.getString('speed');
      const tier     = MIXER_TIERS[speed];
      const available= btc.hotFunds || 0;

      if (available < 1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('No hot funds to mix. Hot funds are generated when you drain business accounts using `/laptop`.')
      ], ephemeral:true });

      const amount   = Math.min(interaction.options.getInteger('amount') || available, available);
      const fee      = Math.floor(amount * tier.fee);
      const clean    = amount - fee;
      const completeAt = Date.now() + tier.hours * 60 * 60 * 1000;

      // ── POLICE INVESTIGATION CHECK ────────────────────────
      // Check if there's an open investigation — hot mix speeds increase detection
      const invCol = await col('policeInvestigations');
      const openInv = await invCol.findOne({ status:'open' }).catch(()=>null);

      let caughtMsg = '';
      let arrested  = false;

      if (openInv) {
        // Detection chance based on speed and existing investigation
        const baseDetect = tier.detectChance;
        const invBonus   = 0.15; // active investigation adds 15%
        const totalDetect= Math.min(0.85, baseDetect + invBonus);
        const roll       = Math.random();

        if (roll < totalDetect) {
          // CAUGHT — jail + confiscate
          arrested = true;

          // Update investigation as solved
          await invCol.updateOne({ _id:openInv._id }, { $set:{ status:'solved', solvedBy:userId, solvedAt:Date.now() }}).catch(()=>{});

          // Add heat and jail
          const { addHeat } = require('../../utils/gangDb');
          await addHeat(userId, 40, 'bitcoin mixing traced');

          const { getConfig } = require('../../utils/db');
          const config = getConfig(interaction.guild.id);
          if (config.prisonRoleId && config.prisonChannelId) {
            const { jailUser } = require('../moderation/jail');
            const jailMins = 10 + Math.floor(Math.random() * 15);
            await jailUser(interaction.guild, userId, jailMins, 'Traced BTC mixing — financial crime', config, null);
          }

          // Seize all hot funds
          btc.hotFunds = 0;
          await saveBtcWallet(userId, btc);

          // Notify the victim/reporter
          if (openInv.reportedBy) {
            try {
              const reporter = await interaction.client.users.fetch(openInv.reportedBy);
              await reporter.send({ embeds:[new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle('🚔 Police Update — Suspect Caught!')
                .setDescription(`Detectives traced the funds from your **${openInv.bizName}** to a Bitcoin mixer.\n\nThe suspect has been **arrested and jailed**. Funds were seized.\n\n*Your report made a difference.*`)
              ]});
            } catch {}
          }

          return interaction.reply({ embeds:[new EmbedBuilder()
            .setColor(0xff3b3b)
            .setTitle('🚔 BUSTED — Bitcoin Traced!')
            .setDescription(`Detectives were already investigating the stolen funds.\n\nYour BTC mixing activity was detected. **$${amount.toLocaleString()}** confiscated. You've been arrested.`)
            .addFields(
              { name:'🕵️ Investigation', value:'Was already open from a police report', inline:true },
              { name:'🎲 Detection',     value:`${Math.round(totalDetect*100)}% chance`, inline:true },
              { name:'💔 All Hot Funds', value:`$${amount.toLocaleString()} seized`,     inline:true },
            )
          ]});
        }

        // Not caught — but investigation advances slightly
        await invCol.updateOne({ _id:openInv._id }, { $inc:{ traceLevel:1 }}).catch(()=>{});
        caughtMsg = '\n\n⚠️ **Active investigation detected** — you narrowly avoided being traced. Mix slower next time.';
      }

      // ── QUEUE THE MIX ─────────────────────────────────────
      btc.hotFunds = Math.max(0, available - amount);

      if (tier.hours === 0) {
        // Instant (fast tier) — goes straight to clean
        btc.cleanFunds = (btc.cleanFunds||0) + clean;
      } else {
        // Queue
        btc.mixQueue = [...(btc.mixQueue||[]), { amount:clean, fee, completeAt, speed }];
      }

      await saveBtcWallet(userId, btc);

      const deliveryStr = tier.hours === 0
        ? 'Instantly available — use `/bitcoin collect`'
        : `Ready in **${tier.hours} hour${tier.hours>1?'s':''}** — use \`/bitcoin collect\` when done`;

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf7931a)
        .setTitle(`₿ ${tier.emoji} ${tier.name} Initiated`)
        .setDescription(`**$${amount.toLocaleString()}** hot funds queued for mixing.${caughtMsg}`)
        .addFields(
          { name:'🔥 Hot In',     value:fmtMoney(amount), inline:true },
          { name:'✅ Clean Out',  value:fmtMoney(clean),  inline:true },
          { name:'✂️ Fee',       value:`${Math.round(tier.fee*100)}% (${fmtMoney(fee)})`, inline:true },
          { name:'⏱️ Delivery',  value:deliveryStr, inline:false },
        )
        .setFooter({ text:'Clean funds → your wallet via /bitcoin collect' })
      ], ephemeral:true });
    }
  },
};
