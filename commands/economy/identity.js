// ============================================================
// commands/economy/identity.js — /identity
// Unified identity theft: browse your stolen SSNs, check
// victim balances, open fraudulent cards, drain existing ones.
// ============================================================
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getUser } = require('../../utils/db');
const {
  getCredit, getOrCreateCredit, saveCredit, adjustScore, getCreditTier,
} = require('../../utils/creditDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS }    = require('../../utils/embeds');

const fmtMoney  = n => '$' + Math.round(n).toLocaleString();
const FRAUD_CD  = new Map();
const FRAUD_MS  = 45 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('identity')
    .setDescription('🪪 Identity theft — use stolen SSNs to scout and commit fraud.')
    .addSubcommand(s => s.setName('stash')
      .setDescription('View every stolen SSN and identity card in your possession'))
    .addSubcommand(s => s.setName('lookup')
      .setDescription('Pull a full profile on a victim using their stolen SSN')
      .addStringOption(o => o.setName('victim').setDescription('Select from your stolen stash').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('balance')
      .setDescription("Peek at a victim's wallet and bank balance via their SSN")
      .addStringOption(o => o.setName('victim').setDescription('Select from your stolen stash').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('fraud')
      .setDescription('Open a fraudulent credit card on a stolen SSN — money goes to you')
      .addStringOption(o => o.setName('victim').setDescription('Select from your stolen stash').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('drain')
      .setDescription("Max out a victim's existing credit card balance to your wallet")
      .addStringOption(o => o.setName('victim').setDescription('Select from your stolen stash').setRequired(true).setAutocomplete(true))),

  async autocomplete(interaction) {
    const { stolenSsnAutocomplete } = require('../../utils/autocomplete');
    return stolenSsnAutocomplete(interaction);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const credit = await getOrCreateCredit(userId);
    const stolen = credit.ssnStolen || {};

    // ── STASH ─────────────────────────────────────────────────
    if (sub === 'stash') {
      const entries = Object.entries(stolen);
      if (!entries.length) {
        return interaction.reply({ embeds:[new EmbedBuilder()
          .setColor(0x1a1a2e)
          .setTitle('🪪 Identity Stash — Empty')
          .setDescription(
            'You have no stolen SSNs.\n\n' +
            '**How to get them:**\n' +
            '• `/hack ssn @user` — steal directly by hacking\n' +
            '• `/tor market` then `/tor buy` — purchase off the dark web\n' +
            '• `/laptop run app:ssn_scanner` — scan with your hacking laptop'
          )
        ], ephemeral:true });
      }

      const lines = entries.map(([victimId, data]) => {
        const member  = interaction.guild.members.cache.get(victimId);
        const name    = member ? `@${member.user.username}` : `Unknown (${victimId.slice(0,6)})`;
        const partial = data.partial ? ' ⚠️ *partial*' : '';
        const hoursAgo = Math.floor((Date.now() - (data.at||0)) / 36e5);
        const src = { tor_market:'TOR Buy', hack:'Hack', ssn_scanner:'Laptop', phish:'Phish' }[data.source] || data.source || 'Unknown';
        return `• **${name}** — \`${data.ssn}\`${partial}\n  Score: **${data.score||'?'}** · ${hoursAgo}h ago · via ${src}`;
      }).join('\n');

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle(`🪪 Identity Stash — ${entries.length} Profile${entries.length !== 1 ? 's' : ''}`)
        .setDescription(lines + '\n\n*⚠️ Partial SSNs cannot be used for fraud.*')
        .setFooter({ text:'Use /identity lookup · balance · fraud · drain to act on any of these' })
      ], ephemeral:true });
    }

    // ── SHARED HELPERS ────────────────────────────────────────
    const victimId  = sub !== 'stash' ? interaction.options.getString('victim') : null;
    const stolenData = victimId ? stolen[victimId] : null;

    const requireStolen = () => {
      if (!stolenData) {
        interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription("You don't have this victim's SSN. Check your `/identity stash`.")
        ], ephemeral:true });
        return false;
      }
      return true;
    };
    const requireFull = () => {
      if (stolenData?.partial) {
        interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription('You only have a **partial SSN** for this victim.\n\nBuy a full SSN profile from `/tor market` to unlock fraud actions.')
        ], ephemeral:true });
        return false;
      }
      return true;
    };
    const getMemberName = () => {
      const m = interaction.guild.members.cache.get(victimId);
      return m ? m.user.username : `User ${victimId.slice(0,8)}`;
    };

    // ── LOOKUP ────────────────────────────────────────────────
    if (sub === 'lookup') {
      if (!requireStolen()) return;
      const vCredit = getCredit(victimId);
      const tier    = vCredit ? getCreditTier(vCredit.score) : null;
      const name    = getMemberName();
      const canFraud = vCredit && !vCredit.frozen && tier?.card;
      const drainable = vCredit?.card ? Math.max(0, (vCredit.limit||0) - (vCredit.balance||0)) : 0;

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle(`🪪 Identity Profile — ${name}`)
        .addFields(
          { name:'🔑 SSN', value:`\`${stolenData.ssn}\`${stolenData.partial ? ' ⚠️ **partial** — limited use' : ' ✅ full'}`, inline:false },
          { name:'📊 Credit Score', value:vCredit ? `**${vCredit.score}** — ${tier.label}` : `**${stolenData.score||'?'}** *(cached)*`, inline:true },
          { name:'❄️ Freeze Status', value:vCredit?.frozen ? '**FROZEN** — fraud blocked' : 'Not frozen — vulnerable', inline:true },
          { name:'💳 Card', value:vCredit?.card
            ? `${tier.card}\nBalance: ${fmtMoney(vCredit.balance||0)} / ${fmtMoney(vCredit.limit||0)}\nAvailable: **${fmtMoney(drainable)}**`
            : 'No card on file', inline:false },
          { name:'🎯 Actions Available', value:[
            canFraud ? '✅ `/identity fraud` — open fraudulent card' : '❌ Fraud blocked (frozen or score too low)',
            drainable >= 100 ? `✅ \`/identity drain\` — steal **${fmtMoney(drainable)}** available balance` : '❌ Nothing to drain (no card or already maxed)',
            '✅ `/identity balance` — view exact wallet & bank amounts',
          ].join('\n'), inline:false },
        )
        .setFooter({ text:`Source: ${stolenData.source||'hack'} · Stolen ${Math.floor((Date.now()-(stolenData.at||0))/864e5)}d ago` })
      ], ephemeral:true });
    }

    // ── BALANCE ───────────────────────────────────────────────
    if (sub === 'balance') {
      if (!requireStolen() || !requireFull()) return;
      const vUser   = getUser(victimId);
      const vCredit = getCredit(victimId);
      const name    = getMemberName();
      if (!vUser) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888)
        .setDescription('No account found for this victim.')
      ], ephemeral:true });

      const total    = (vUser.wallet||0) + (vUser.bank||0);
      const cardAvail = vCredit?.card ? Math.max(0, (vCredit.limit||0) - (vCredit.balance||0)) : 0;

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle(`💰 Account Lookup — ${name}`)
        .setDescription(`*Accessing financial records via SSN \`${stolenData.ssn}\`...*`)
        .addFields(
          { name:'💵 Wallet',          value:fmtMoney(vUser.wallet||0),  inline:true },
          { name:'🏦 Bank',            value:fmtMoney(vUser.bank||0),    inline:true },
          { name:'💰 Total',           value:fmtMoney(total),            inline:true },
          { name:'💳 Card Available',  value:cardAvail > 0 ? `${fmtMoney(cardAvail)} ← drainable` : 'None / maxed', inline:true },
          { name:'📊 Credit Score',    value:`${vCredit?.score || stolenData.score || '?'}`, inline:true },
        )
        .setFooter({ text:'Use /identity fraud to open a card · /identity drain to take card funds' })
      ], ephemeral:true });
    }

    // ── FRAUD ─────────────────────────────────────────────────
    if (sub === 'fraud') {
      if (!requireStolen() || !requireFull()) return;

      const last = FRAUD_CD.get(userId) || 0;
      if (Date.now() - last < FRAUD_MS) {
        const mins = Math.ceil((FRAUD_MS - (Date.now()-last)) / 60000);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`Identity fraud cooldown: **${mins} min** remaining.`)
        ], ephemeral:true });
      }

      const vCredit = await getOrCreateCredit(victimId);
      if (vCredit.frozen) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('This victim has a **credit freeze** — fraud cannot be committed on their SSN.')
      ], ephemeral:true });

      const tier = getCreditTier(vCredit.score);
      if (!tier.card) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Victim's credit score (**${vCredit.score}**) is too low — no card tier to exploit.`)
      ], ephemeral:true });

      const vUser = getOrCreateUser(victimId);
      const fraudLimit  = Math.floor((vUser.bank||0) * (tier.limitPct||0.2) * 0.5);
      if (fraudLimit < 200) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription("Victim's bank balance is too low to exploit.")
      ], ephemeral:true });

      const fraudAmount = Math.floor(fraudLimit * (0.5 + Math.random() * 0.5));
      const hacker      = getOrCreateUser(userId);
      hacker.wallet    += fraudAmount;
      vCredit.balance   = (vCredit.balance||0) + fraudAmount;
      vCredit.limit     = Math.max(vCredit.limit||0, fraudLimit);
      if (!vCredit.card) vCredit.card = tier.card;

      await adjustScore(victimId, -45, 'Identity fraud — fraudulent card opened via stolen SSN');
      saveUser(userId, hacker);
      await saveCredit(victimId, vCredit);
      FRAUD_CD.set(userId, Date.now());

      try { const { addHeat } = require('../../utils/gangDb'); await addHeat(userId, 35, 'identity fraud'); } catch {}
      try {
        const u = await interaction.client.users.fetch(victimId);
        u.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
          .setTitle('🚨 Fraudulent Account Opened!')
          .setDescription(`A credit card was opened on your SSN.\n\n💳 Charges: **${fmtMoney(fraudAmount)}**\n📊 Credit hit: **-45 pts**\n\nFreeze immediately: \`/credit freeze\``)
        ]}).catch(()=>{});
      } catch {}

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('💳 Identity Fraud — Success')
        .setDescription(
          `Opened a **${tier.card}** under **${getMemberName()}**'s identity.\n\n` +
          `💰 Stolen: **${fmtMoney(fraudAmount)}** → your wallet\n` +
          `💵 Your wallet: **${fmtMoney(hacker.wallet)}**\n` +
          `📊 Their score: **-45 pts**\n` +
          `⚠️ +35 heat added`
        )
      ], ephemeral:true });
    }

    // ── DRAIN ─────────────────────────────────────────────────
    if (sub === 'drain') {
      if (!requireStolen() || !requireFull()) return;

      const last = FRAUD_CD.get(userId) || 0;
      if (Date.now() - last < FRAUD_MS) {
        const mins = Math.ceil((FRAUD_MS - (Date.now()-last)) / 60000);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`Identity fraud cooldown: **${mins} min** remaining.`)
        ], ephemeral:true });
      }

      const vCredit = await getOrCreateCredit(victimId);
      if (!vCredit.card) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('This victim has no credit card to drain. Use `/identity fraud` to open one first.')
      ], ephemeral:true });

      const avail = Math.max(0, (vCredit.limit||0) - (vCredit.balance||0));
      if (avail < 100) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription("This victim's card is already maxed — nothing left to drain.")
      ], ephemeral:true });

      const hacker = getOrCreateUser(userId);
      hacker.wallet += avail;
      vCredit.balance += avail;
      await adjustScore(victimId, -25, 'Card drained via identity theft');
      saveUser(userId, hacker);
      await saveCredit(victimId, vCredit);
      FRAUD_CD.set(userId, Date.now());

      try { const { addHeat } = require('../../utils/gangDb'); await addHeat(userId, 25, 'card drain'); } catch {}
      try {
        const u = await interaction.client.users.fetch(victimId);
        u.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
          .setTitle('🚨 Card Drained!')
          .setDescription(`Your credit card was maxed out via stolen identity.\n\n💸 Drained: **${fmtMoney(avail)}**\n📊 Score: **-25 pts**\n\nFreeze your credit: \`/credit freeze\``)
        ]}).catch(()=>{});
      } catch {}

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('💸 Card Drain — Success')
        .setDescription(
          `Drained **${fmtMoney(avail)}** from **${getMemberName()}**'s card.\n\n` +
          `💰 Added to your wallet.\n` +
          `💵 Your wallet: **${fmtMoney(hacker.wallet)}**\n` +
          `📊 Their score: **-25 pts**`
        )
      ], ephemeral:true });
    }
  },
};
