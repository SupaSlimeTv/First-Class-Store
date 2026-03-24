// ============================================================
// commands/economy/credit.js — /credit
// Credit cards, scores, loans, identity freeze
// ============================================================
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, hasAccount } = require('../../utils/db');
const { getOrCreateCredit, saveCredit, adjustScore, getCreditTier, calcLoanPayment } = require('../../utils/creditDb');
const { COLORS } = require('../../utils/embeds');
const { noAccount } = require('../../utils/accountCheck');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('credit')
    .setDescription('💳 Manage your credit card, score, and loans.')
    .addSubcommand(s => s.setName('check').setDescription('View your credit score, SSN, and card status'))
    .addSubcommand(s => s.setName('apply').setDescription('Apply for a credit card'))
    .addSubcommand(s => s.setName('spend').setDescription('Charge a purchase to your credit card')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to charge').setRequired(true).setMinValue(1))
      .addStringOption(o => o.setName('note').setDescription('What is this for?').setRequired(false)))
    .addSubcommand(s => s.setName('pay').setDescription('Pay down your credit card balance')
      .addStringOption(o => o.setName('amount').setDescription('Amount to pay or "all"').setRequired(true)))
    .addSubcommand(s => s.setName('freeze').setDescription('Freeze your credit — prevents anyone applying cards on your SSN'))
    .addSubcommand(s => s.setName('unfreeze').setDescription('Unfreeze your credit'))
    .addSubcommand(s => s.setName('loan').setDescription('Apply for a business financing loan')
      .addIntegerOption(o => o.setName('amount').setDescription('Loan amount').setRequired(true).setMinValue(10000))
      .addIntegerOption(o => o.setName('days').setDescription('Repayment term in days (7-30)').setRequired(true).setMinValue(7).setMaxValue(30))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const credit = await getOrCreateCredit(userId);
    const tier   = getCreditTier(credit.score);

    // ── CHECK ─────────────────────────────────────────────────
    if (sub === 'check') {
      const user = getOrCreateUser(userId);
      const limit = credit.card ? credit.limit : Math.floor((user.bank||0) * (tier.limitPct||0));
      const utilization = credit.limit > 0 ? Math.round((credit.balance/credit.limit)*100) : 0;
      const loans = (credit.loans||[]).filter(l=>!l.paid);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(tier.color)
        .setTitle('💳 Your Credit Profile')
        .addFields(
          { name:'🪪 SSN',           value:`||${credit.ssn}||`,                                    inline:true },
          { name:'📊 Credit Score',  value:`**${credit.score}** — ${tier.label}`,                  inline:true },
          { name:'❄️ Frozen',        value:credit.frozen ? '**YES** — credit locked' : 'No',       inline:true },
          { name:'💳 Card',          value:credit.card ? `${tier.card}\nBalance: ${fmtMoney(credit.balance)} / ${fmtMoney(credit.limit)}` : 'None — use `/credit apply`', inline:false },
          { name:'📈 Utilization',   value:credit.card ? `${utilization}%` : 'N/A',                inline:true },
          { name:'✅ On-Time Payments',value:`${credit.payments||0}`,                               inline:true },
          { name:'❌ Missed',        value:`${credit.missed||0}`,                                   inline:true },
          ...(loans.length ? [{ name:`💼 Active Loans (${loans.length})`, value:loans.map(l=>`${fmtMoney(l.remaining)} remaining — due ${new Date(l.due).toLocaleDateString()}`).join('\n'), inline:false }] : []),
        )
        .setFooter({ text:'SSN is blurred — click to reveal. Keep it private.' })
      ], ephemeral:true });
    }

    // ── APPLY ─────────────────────────────────────────────────
    if (sub === 'apply') {
      if (credit.frozen) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('❄️ Your credit is frozen. Unfreeze it first with `/credit unfreeze`.')
      ], ephemeral:true });
      if (credit.card) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You already have a **${credit.card}**. Pay it off and close it before applying again.`)
      ], ephemeral:true });
      if (!tier.card) return interaction.reply({ embeds:[new EmbedBuilder().setColor(tier.color)
        .setTitle('❌ Application Denied')
        .setDescription(`Your score of **${credit.score}** (${tier.label}) is too low to qualify for a credit card.\n\nBuild your score by:\n• Paying loans on time\n• Keeping utilization low\n• Avoiding missed payments\n\nMinimum score needed: **580**`)
      ], ephemeral:true });

      const user  = getOrCreateUser(userId);
      const limit = Math.floor((user.bank||0) * tier.limitPct);
      if (limit < 500) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Your bank balance is too low to qualify. Deposit more to your bank first.\n\nYour limit would be **${Math.round(tier.limitPct*100)}%** of your bank balance.`)
      ], ephemeral:true });

      credit.card        = tier.card;
      credit.limit       = limit;
      credit.balance     = 0;
      credit.lastBilling = Date.now();
      await saveCredit(userId, credit);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(tier.color)
        .setTitle(`✅ ${tier.card} Approved!`)
        .setDescription(`Congratulations! Your **${tier.card}** has been issued.\n\n💳 Credit Limit: **${fmtMoney(limit)}**\n📊 Score: **${credit.score}** (${tier.label})\n💸 Interest: **${tier.interestDay*100}%/day** if unpaid after 7 days\n\nUse \`/credit spend\` to charge purchases.`)
      ], ephemeral:true });
    }

    // ── SPEND ─────────────────────────────────────────────────
    if (sub === 'spend') {
      if (!credit.card) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No card. Apply with `/credit apply`.')], ephemeral:true });
      const amount = interaction.options.getInteger('amount');
      const note   = interaction.options.getString('note') || 'Purchase';
      const avail  = credit.limit - credit.balance;
      if (amount > avail) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Only **${fmtMoney(avail)}** available on your card.\nBalance: ${fmtMoney(credit.balance)} / ${fmtMoney(credit.limit)}`)
      ], ephemeral:true });

      const user    = getOrCreateUser(userId);
      user.wallet  += amount; // credit goes to wallet
      credit.balance += amount;
      saveUser(userId, user);
      await saveCredit(userId, credit);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('💳 Charged to Card')
        .setDescription(`**${fmtMoney(amount)}** added to wallet.\n\n📝 ${note}\n💳 Balance: **${fmtMoney(credit.balance)} / ${fmtMoney(credit.limit)}**\n💵 Wallet: **${fmtMoney(user.wallet)}**\n\n⚠️ Pay before 7 days to avoid ${getCreditTier(credit.score).interestDay*100}%/day interest.`)
      ], ephemeral:true });
    }

    // ── PAY ───────────────────────────────────────────────────
    if (sub === 'pay') {
      if (!credit.card || credit.balance === 0) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('No balance to pay.')], ephemeral:true });
      const raw    = interaction.options.getString('amount').toLowerCase().trim();
      const user   = getOrCreateUser(userId);
      const amount = raw === 'all' ? Math.min(credit.balance, user.wallet) : parseInt(raw.replace(/,/g,''));
      if (isNaN(amount) || amount < 1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Enter a valid amount or "all".')], ephemeral:true });
      if (amount > user.wallet) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Only have ${fmtMoney(user.wallet)} in wallet.`)], ephemeral:true });

      user.wallet    -= amount;
      credit.balance  = Math.max(0, credit.balance - amount);
      if (credit.balance === 0) {
        credit.payments = (credit.payments||0) + 1;
        await adjustScore(userId, 8, 'On-time full payment');
      }
      saveUser(userId, user);
      await saveCredit(userId, credit);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Payment Made')
        .setDescription(`Paid **${fmtMoney(amount)}** toward your card.\n\n💳 Remaining balance: **${fmtMoney(credit.balance)}**\n💵 Wallet: **${fmtMoney(user.wallet)}**${credit.balance===0?'\n\n🎉 Card paid off! +8 credit score':'' }`)
      ], ephemeral:true });
    }

    // ── FREEZE / UNFREEZE ─────────────────────────────────────
    if (sub === 'freeze') {
      credit.frozen = true;
      await saveCredit(userId, credit);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x5865f2)
        .setDescription('❄️ Credit frozen. No one — including you — can open new cards on your SSN.')
      ], ephemeral:true });
    }
    if (sub === 'unfreeze') {
      credit.frozen = false;
      await saveCredit(userId, credit);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
        .setDescription('✅ Credit unfrozen.')
      ], ephemeral:true });
    }

    // ── LOAN ──────────────────────────────────────────────────
    if (sub === 'loan') {
      if (credit.score < 670) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Business loans require a **Good (670+)** credit score.\nYour score: **${credit.score}** (${tier.label})`)
      ], ephemeral:true });
      if ((credit.loans||[]).filter(l=>!l.paid).length >= 2) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('Max 2 active loans at a time.')
      ], ephemeral:true });

      const amount  = interaction.options.getInteger('amount');
      const days    = interaction.options.getInteger('days');
      const daily   = calcLoanPayment(amount, days);
      const total   = daily * days;

      const user = getOrCreateUser(userId);
      user.wallet += amount;
      saveUser(userId, user);

      const loan = { id:Date.now(), principal:amount, remaining:total, dailyPayment:daily, due:Date.now()+days*86400000, startedAt:Date.now(), paid:false };
      credit.loans = [...(credit.loans||[]), loan];
      await saveCredit(userId, credit);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(tier.color)
        .setTitle('💼 Business Loan Approved')
        .setDescription(`**${fmtMoney(amount)}** deposited to your wallet.\n\n📅 Term: **${days} days**\n💸 Daily payment: **${fmtMoney(daily)}** (auto-deducted from wallet/bank)\n💰 Total repayment: **${fmtMoney(total)}**\n📆 Due: **${new Date(Date.now()+days*86400000).toLocaleDateString()}**\n\n⚠️ Defaulting destroys your credit score.`)
      ], ephemeral:true });
    }
  },
};
