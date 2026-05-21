// ============================================================
// commands/economy/voodoo.js — /voodoo
// ============================================================
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();

const VOODOO_COLOR   = 0x2c0a3f;
const SUCCESS_COLOR  = 0x7c3aed;
const FAILURE_COLOR  = 0x6b0000;
const MASTER_COLOR   = 0xf5c518;

const VOODOO_MASTER_THRESHOLD = 50;

const MASTERY_TIERS = [
  { min: 0,  label: 'Initiate',      emoji: '🕯️' },
  { min: 10, label: 'Adept',         emoji: '🔮' },
  { min: 25, label: 'Conjurer',      emoji: '🌑' },
  { min: 50, label: 'Voodoo Master', emoji: '✨' },
];

function getMasteryTier(ritualCount) {
  let tier = MASTERY_TIERS[0];
  for (const t of MASTERY_TIERS) { if (ritualCount >= t.min) tier = t; }
  return tier;
}

function isMaster(v) {
  return (v?.ritualCount || 0) >= VOODOO_MASTER_THRESHOLD;
}

// ── LWA (spirits/deities) ────────────────────────────────────
const LWA = {
  baron_samedi: {
    name: 'Baron Samedi',
    emoji: '☠️',
    domain: 'Death, Protection & Dark Humor',
    flavor: 'The lord of the dead guards the gates between worlds. He blesses those who honor him — and punishes those who come weak.',
    ritual: 'Death\'s Door Offering',
    cost: 25000,
    successChance: 0.60,
    requiresTarget: false,
    successTitle: '☠️ Baron Samedi Blesses You',
    successDesc: (amt, _) => `Baron laughs and tosses **${fmtMoney(amt)}** your way.\n\n*"Come back when you\'re dead, mon ami."*\n\nA shimmer of dark energy surrounds your wallet.`,
    failTitle: '☠️ Baron Samedi Takes His Cut',
    failDesc: (amt, _) => `The offering wasn't enough. Baron reaches into your wallet and takes **${fmtMoney(amt)}**.\n\n*"Everyone pays eventually."*`,
    successPayout: () => Math.floor(30000 + Math.random() * 60000),
    failureDrain: (wallet) => Math.floor(wallet * 0.20),
  },

  erzulie_freda: {
    name: 'Erzulie Freda',
    emoji: '💕',
    domain: 'Love, Beauty & Wealth',
    flavor: 'The Lwa of luxury and romantic love. She lavishes wealth on those who honor her — but she is vain and easily scorned.',
    ritual: 'Perfume & Rose Offering',
    cost: 15000,
    successChance: 0.55,
    requiresTarget: false,
    successTitle: '💕 Erzulie Freda Is Pleased',
    successDesc: (amt, _) => `She smiles upon you. **${fmtMoney(amt)}** manifests in your wallet like a love letter from the spirit world.\n\n*"Beautiful. Just like me."*`,
    failTitle: '💕 Erzulie Freda Is Scorned',
    failDesc: (amt, _) => `She found your offering unworthy and takes back her gifts — **${fmtMoney(amt)}** disappears from your wallet.\n\n*"Next time bring roses — not weeds."*`,
    successPayout: () => Math.floor(50000 + Math.random() * 55000),
    failureDrain: () => 25000,
  },

  ogou: {
    name: 'Ogou',
    emoji: '⚔️',
    domain: 'War, Iron & Righteous Strength',
    flavor: 'Warrior spirit of iron and fire. He forges strength in those who seek it — but the forge burns those who aren\'t ready.',
    ritual: 'Rum on Hot Iron',
    cost: 20000,
    successChance: 0.65,
    requiresTarget: false,
    successTitle: '⚔️ Ogou Walks With You',
    successDesc: (amt, _) => `Iron strength flows through you. **${fmtMoney(amt)}** is yours — Ogou's battle blessing.\n\n*"Fight. Take. Win."*`,
    failTitle: '⚔️ The Iron Burns You',
    failDesc: (amt, _) => `The forge wasn't meant for you today. **${fmtMoney(amt)}** is lost to the flame.\n\n*"Come back stronger."*`,
    successPayout: () => Math.floor(35000 + Math.random() * 40000),
    failureDrain: () => 18000,
  },

  papa_legba: {
    name: 'Papa Legba',
    emoji: '🔑',
    domain: 'Crossroads, Communication & Fate',
    flavor: 'The old man at the crossroads controls all doors between the living and the dead. No spirit speaks without his permission.',
    ritual: 'Crossroads Midnight Offering',
    cost: 10000,
    successChance: 0.50,
    requiresTarget: false,
    successTitle: '🔑 Papa Legba Opens the Door',
    successDesc: (amt, _) => `The old man grins and opens the lucky door. **${fmtMoney(amt)}** walks through.\n\n*"Ayibobo. The path is clear."*`,
    failTitle: '🔑 Papa Legba Closes the Door',
    failDesc: (amt, _) => `He shakes his head and shuts every door you had open. **${fmtMoney(amt)}** drained away into the crossroads dust.\n\n*"Wrong time. Wrong place."*`,
    successPayout: () => Math.floor(20000 + Math.random() * 45000),
    failureDrain: () => 15000,
  },

  ayizan: {
    name: 'Ayizan',
    emoji: '🌿',
    domain: 'Commerce, Healing & The Market',
    flavor: 'Earth mother of healing and trade. She blesses markets and enterprises — but her blessing only flows where the soil is pure.',
    ritual: 'Coconut & White Cloth Offering',
    cost: 30000,
    successChance: 0.70,
    requiresTarget: false,
    successTitle: '🌿 Ayizan Blesses Your Commerce',
    successDesc: (amt, _) => `The market bends in your favor. **${fmtMoney(amt)}** flows into your hands.\n\n*"The earth provides for those who tend it."*`,
    failTitle: '🌿 Your Offering Was Impure',
    failDesc: (amt, _) => `Ayizan turns away. The earth takes back what was owed — **${fmtMoney(amt)}** gone.\n\n*"Come with clean hands next time."*`,
    successPayout: () => Math.floor(55000 + Math.random() * 60000),
    failureDrain: () => 22000,
  },

  maman_brigitte: {
    name: 'Maman Brigitte',
    emoji: '🕯️',
    domain: 'Death, Justice & Retribution',
    flavor: 'Baron Samedi\'s wife — fierce, hot-peppered, and just. She delivers vengeance to the wicked and heals the righteous.',
    ritual: 'Grave Pepper & Rum Hex',
    cost: 40000,
    successChance: 0.55,
    requiresTarget: true,
    successTitle: '🕯️ Maman Brigitte\'s Curse Lands',
    successDesc: (amt, target) => `Justice has been delivered. **${fmtMoney(amt)}** drained from <@${target}>'s wallet and into yours.\n\n*"The grave doesn't forget. Neither do I."*`,
    failTitle: '🕯️ Justice Turns Its Eye to You',
    failDesc: (amt, _) => `Maman Brigitte decided YOU were the one who needed a lesson. **${fmtMoney(amt)}** taken from your own wallet.\n\n*"Watch who you curse, child."*`,
    successPayout: (targetWallet) => Math.floor(targetWallet * 0.15),
    failureDrain: (wallet) => Math.floor(wallet * 0.10),
  },
};

const INITIATION_COST = 50000;
const COOLDOWN_MS = {
  baron_samedi:   3 * 24 * 3600 * 1000,
  erzulie_freda:  2 * 24 * 3600 * 1000,
  ogou:           4 * 24 * 3600 * 1000,
  papa_legba:     2 * 24 * 3600 * 1000,
  ayizan:         4 * 24 * 3600 * 1000,
  maman_brigitte: 3 * 24 * 3600 * 1000,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voodoo')
    .setDescription('🕯️ Commune with the Lwa — perform voodoo rituals for gain, fame, or revenge')
    .addSubcommand(s => s
      .setName('initiate')
      .setDescription(`Begin your voodoo journey (one-time initiation — ${fmtMoney(INITIATION_COST)})`))
    .addSubcommand(s => s
      .setName('status')
      .setDescription('View your voodoo standing, energy, mastery, and ritual history'))
    .addSubcommand(s => s
      .setName('ritual')
      .setDescription('Perform a ritual with a Lwa spirit')
      .addStringOption(o => o
        .setName('deity')
        .setDescription('Choose your Lwa (spirit)')
        .setRequired(true)
        .addChoices(
          { name: '☠️ Baron Samedi — Death & Protection ($25k · 60% success)',       value: 'baron_samedi' },
          { name: '💕 Erzulie Freda — Love & Wealth ($15k · 55% success)',            value: 'erzulie_freda' },
          { name: '⚔️ Ogou — War & Strength ($20k · 65% success)',                    value: 'ogou' },
          { name: '🔑 Papa Legba — Crossroads & Fate ($10k · 50/50)',                 value: 'papa_legba' },
          { name: '🌿 Ayizan — Commerce & Healing ($30k · 70% success)',              value: 'ayizan' },
          { name: '🕯️ Maman Brigitte — Hex & Justice ($40k · requires target)',       value: 'maman_brigitte' },
        ))
      .addUserOption(o => o
        .setName('target')
        .setDescription('Maman Brigitte: curse target. Voodoo Master: cast any ritual FOR someone (they get the payout)')
        .setRequired(false))),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    if (await noAccount(interaction)) return;

    const user = getOrCreateUser(userId);

    // ── INITIATE ──────────────────────────────────────────────
    if (sub === 'initiate') {
      if (user.voodoo?.initiated) return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(VOODOO_COLOR)
        .setTitle('🕯️ Already Initiated')
        .setDescription(`You are already a practitioner of the voodoo arts.\n\nUse \`/voodoo status\` to see your standing, or \`/voodoo ritual\` to commune with a Lwa.`)
      ], ephemeral:true });

      if (user.wallet < INITIATION_COST) return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setDescription(`Initiation costs **${fmtMoney(INITIATION_COST)}**. You have **${fmtMoney(user.wallet)}**.`)
      ], ephemeral:true });

      user.wallet -= INITIATION_COST;
      user.voodoo = {
        initiated: true,
        initiatedAt: Date.now(),
        energy: 10,
        ritualCount: 0,
        lastRituals: {},
      };
      await saveUser(userId, user);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(VOODOO_COLOR)
        .setTitle('🕯️ The Veil Has Opened')
        .setDescription(
          `**${fmtMoney(INITIATION_COST)}** has been offered to the spirits as your initiation tribute.\n\n` +
          'You are now a practitioner of the voodoo arts. The Lwa have acknowledged you.\n\n' +
          '**The Six Lwa you may commune with:**\n' +
          '☠️ **Baron Samedi** — Death & protection\n' +
          '💕 **Erzulie Freda** — Love & wealth\n' +
          '⚔️ **Ogou** — War & strength\n' +
          '🔑 **Papa Legba** — Crossroads & fate\n' +
          '🌿 **Ayizan** — Commerce & healing\n' +
          '🕯️ **Maman Brigitte** — Hex & justice *(requires a target)*\n\n' +
          '**Mastery Path:**\n' +
          '🕯️ Initiate (0) → 🔮 Adept (10) → 🌑 Conjurer (25) → ✨ **Voodoo Master (50)**\n\n' +
          '*Reach **Voodoo Master** (50 rituals) to cast freely — no cost, 98% success, and the power to bless others.*\n\n' +
          'Use `/voodoo ritual deity:<spirit>` to perform a ritual.\n\n' +
          '*Every ritual has a cost. Every spirit has a will. Results are never guaranteed — until you master them.*'
        )
        .setFooter({ text:'Starting voodoo energy: 10 ⚡' })
      ], ephemeral:true });
    }

    // ── STATUS ─────────────────────────────────────────────────
    if (sub === 'status') {
      if (!user.voodoo?.initiated) return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(VOODOO_COLOR)
        .setTitle('🕯️ Not Initiated')
        .setDescription('You have not been initiated into the voodoo arts.\n\nUse `/voodoo initiate` to begin your journey.')
      ], ephemeral:true });

      const v       = user.voodoo;
      const now     = Date.now();
      const count   = v.ritualCount || 0;
      const tier    = getMasteryTier(count);
      const master  = count >= VOODOO_MASTER_THRESHOLD;

      // Progress to next tier
      const nextTier = MASTERY_TIERS.find(t => t.min > count);
      const progressLine = master
        ? '✨ **Voodoo Master** — Rituals cost nothing. Success guaranteed. Power over life and death.'
        : `Progress to **${nextTier.emoji} ${nextTier.label}**: **${count} / ${nextTier.min}** rituals`;

      const cooldownLines = Object.entries(COOLDOWN_MS).map(([key, cd]) => {
        const lwa = LWA[key];
        const last = v.lastRituals?.[key] || 0;
        const remaining = last + cd - now;
        const status = remaining > 0
          ? `<t:${Math.floor((last + cd) / 1000)}:R>`
          : '✅ Ready';
        return `${lwa.emoji} **${lwa.name}** — ${status}`;
      }).join('\n');

      const masterPerks = master
        ? '\n\n✨ **MASTER PERKS ACTIVE**\n• All rituals are **FREE**\n• **98% success rate** on all Lwa\n• Cast any ritual **FOR others** — they receive the payout'
        : '';

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(master ? MASTER_COLOR : VOODOO_COLOR)
        .setTitle(`${tier.emoji} Voodoo Standing — ${tier.label}`)
        .setDescription(`*"The spirits remember every offering."*${masterPerks}`)
        .addFields(
          { name:'⚡ Voodoo Energy',    value:`${v.energy || 0}`,     inline:true },
          { name:'🔮 Rituals Performed', value:`${count}`,             inline:true },
          { name:'📅 Initiated',         value:`<t:${Math.floor(v.initiatedAt/1000)}:D>`, inline:true },
          { name:'📈 Mastery Progress',  value:progressLine,           inline:false },
          { name:'🕯️ Ritual Cooldowns', value:cooldownLines,          inline:false },
        )
      ], ephemeral:true });
    }

    // ── RITUAL ─────────────────────────────────────────────────
    if (sub === 'ritual') {
      if (!user.voodoo?.initiated) return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(VOODOO_COLOR)
        .setTitle('🕯️ Not Initiated')
        .setDescription('You must be initiated before communing with the Lwa.\n\nUse `/voodoo initiate` first.')
      ], ephemeral:true });

      const deityKey    = interaction.options.getString('deity');
      const target      = interaction.options.getUser('target');
      const lwa         = LWA[deityKey];
      if (!lwa) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Unknown spirit.')], ephemeral:true });

      const v           = user.voodoo;
      const master      = isMaster(v);
      const castForOther = master && target && !lwa.requiresTarget && target.id !== userId;

      if (lwa.requiresTarget && !target) return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setTitle(`🕯️ ${lwa.name} Requires a Target`)
        .setDescription(`The **Hex of Justice** ritual requires a target user.\n\nUse \`/voodoo ritual deity:Maman Brigitte target:@user\``)
      ], ephemeral:true });

      if (target?.id === userId) return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(COLORS.ERROR).setDescription('You cannot target yourself.')
      ], ephemeral:true });

      // Voodoo Masters can't cast for non-initiated? No restriction — bless anyone.

      // Check cooldown
      const now      = Date.now();
      const lastUsed = v.lastRituals?.[deityKey] || 0;
      const cooldown = COOLDOWN_MS[deityKey];
      if (now - lastUsed < cooldown) {
        const readyAt = Math.floor((lastUsed + cooldown) / 1000);
        return interaction.reply({ embeds:[new EmbedBuilder()
          .setColor(VOODOO_COLOR)
          .setTitle(`${lwa.emoji} ${lwa.name} Is Not Ready`)
          .setDescription(`${lwa.name} demands time between offerings.\n\nReady again: <t:${readyAt}:R>`)
        ], ephemeral:true });
      }

      // Cost — free for masters
      const cost = master ? 0 : lwa.cost;
      if (cost > 0 && user.wallet < cost) return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setDescription(`The **${lwa.ritual}** costs **${fmtMoney(cost)}**. You only have **${fmtMoney(user.wallet)}**.`)
      ], ephemeral:true });

      await interaction.deferReply({ ephemeral:true });

      if (cost > 0) user.wallet -= cost;

      // Success rate — 98% for masters, normal otherwise
      const successChance = master ? 0.98 : lwa.successChance;
      const success       = Math.random() < successChance;

      if (!v.lastRituals) v.lastRituals = {};
      v.lastRituals[deityKey] = now;
      v.ritualCount           = (v.ritualCount || 0) + 1;
      v.energy                = Math.max(0, (v.energy || 0) + (success ? 2 : -1));

      const newTier     = getMasteryTier(v.ritualCount);
      const justMastered = v.ritualCount === VOODOO_MASTER_THRESHOLD;

      if (success) {
        let payout = 0;
        let desc   = '';

        if (deityKey === 'maman_brigitte' && target) {
          // Curse — drain target regardless of master status
          const targetUser = getOrCreateUser(target.id);
          payout = lwa.successPayout(targetUser.wallet || 0);
          if (payout > 0) {
            targetUser.wallet = Math.max(0, targetUser.wallet - payout);
            await saveUser(target.id, targetUser);
            target.send({ embeds:[new EmbedBuilder()
              .setColor(FAILURE_COLOR)
              .setTitle('🕯️ You\'ve Been Hexed')
              .setDescription(`A voodoo ritual was performed against you by <@${userId}>.\n\nMaman Brigitte has drained **${fmtMoney(payout)}** from your wallet as her justice.\n\n*"The grave doesn't forget."*`)
            ]}).catch(() => null);
          }
          user.wallet += payout;
          desc = lwa.successDesc(payout, target.id);

        } else if (castForOther) {
          // Master casting a blessing FOR another user
          payout = lwa.successPayout();
          const targetUser = getOrCreateUser(target.id);
          targetUser.wallet += payout;
          await saveUser(target.id, targetUser);
          // Notify the recipient
          target.send({ embeds:[new EmbedBuilder()
            .setColor(SUCCESS_COLOR)
            .setTitle(`${lwa.emoji} ${lwa.name} Has Blessed You`)
            .setDescription(`A Voodoo Master (<@${userId}>) performed the **${lwa.ritual}** on your behalf.\n\n**${fmtMoney(payout)}** was sent to your wallet by the spirits.\n\n*"The Lwa have spoken."*`)
          ]}).catch(() => null);
          desc = `${lwa.successDesc(payout, null)}\n\n*Blessing directed to <@${target.id}> — **${fmtMoney(payout)}** sent to their wallet.*`;

        } else {
          payout = lwa.successPayout();
          user.wallet += payout;
          desc = lwa.successDesc(payout, null);
        }

        await saveUser(userId, user);

        const masterUnlock = justMastered
          ? '\n\n✨ **VOODOO MASTER ACHIEVED!** You have performed 50 rituals. All future rituals cost nothing, succeed 98% of the time, and you may now bless others by adding `target:@user` to any ritual.'
          : '';

        return interaction.editReply({ embeds:[new EmbedBuilder()
          .setColor(master ? MASTER_COLOR : SUCCESS_COLOR)
          .setTitle(`${master ? '✨ ' : ''}${lwa.successTitle}`)
          .setDescription(
            `*You ${master ? 'channel the spirits effortlessly' : 'lit the candles, poured the rum, and called the name'}.*\n\n` +
            desc +
            `\n\n**Ritual:** ${lwa.ritual} · **Cost:** ${cost > 0 ? fmtMoney(cost) : '**FREE** ✨'}\n` +
            `**Earned:** +${fmtMoney(payout)} · **Voodoo Energy:** ${v.energy} ⚡\n` +
            `**Mastery:** ${newTier.emoji} ${newTier.label} (${v.ritualCount} rituals)` +
            masterUnlock
          )
        ]});

      } else {
        // Failure
        const drained = lwa.failureDrain(user.wallet);
        user.wallet   = Math.max(0, user.wallet - drained);
        const desc    = lwa.failDesc(drained, null);

        await saveUser(userId, user);
        return interaction.editReply({ embeds:[new EmbedBuilder()
          .setColor(FAILURE_COLOR)
          .setTitle(lwa.failTitle)
          .setDescription(
            `*You lit the candles, poured the rum, and called the name.*\n\n` +
            desc +
            `\n\n**Ritual:** ${lwa.ritual} · **Cost:** ${cost > 0 ? fmtMoney(cost) : '**FREE** ✨'}\n` +
            `**Drained:** -${fmtMoney(drained)} · **Voodoo Energy:** ${v.energy} ⚡\n` +
            `**Mastery:** ${newTier.emoji} ${newTier.label} (${v.ritualCount} rituals)`
          )
        ]});
      }
    }
  },
};
