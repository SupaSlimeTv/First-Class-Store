// commands/economy/debit.js — /debit
// Debit card linked to bank. Hackers can steal card numbers.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, hasAccount } = require('../../utils/db');
const { getDebitCard, createDebitCard, saveDebitCard } = require('../../utils/debitDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debit')
    .setDescription('Manage your debit card — linked directly to your bank account')
    .addSubcommand(s => s.setName('create').setDescription('Create a debit card linked to your bank'))
    .addSubcommand(s => s.setName('view').setDescription('View your debit card info (private)'))
    .addSubcommand(s => s.setName('pay').setDescription('Pay an amount directly from your bank via debit')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to pay').setRequired(true).setMinValue(1))
      .addStringOption(o => o.setName('note').setDescription('What this is for').setRequired(false)))
    .addSubcommand(s => s.setName('freeze').setDescription('Freeze your debit card — blocks all transactions'))
    .addSubcommand(s => s.setName('unfreeze').setDescription('Unfreeze your debit card'))
    .addSubcommand(s => s.setName('drain').setDescription('Use a stolen debit card number to drain the victim bank')
      .addStringOption(o => o.setName('card_number').setDescription('Stolen card number (from Stalker App)').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to steal (leave blank for max)').setRequired(false))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const userId = interaction.user.id;
    const sub    = interaction.options.getSubcommand();
    const user   = getOrCreateUser(userId);

    // ── CREATE ────────────────────────────────────────────────
    if (sub === 'create') {
      const existing = getDebitCard(userId);
      if (existing) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('You already have a debit card. Use `/debit view` to see it.\n\nGuard your card number — hackers can steal it and drain your bank!')
      ], ephemeral:true });

      const card = await createDebitCard(userId);
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('💳 Debit Card Created!')
        .setDescription('Your debit card is now linked to your **bank account**.\n\n⚠️ **Keep this private! Hackers can steal your card number and drain your bank.**')
        .addFields(
          { name:'💳 Card Number', value:'`' + card.cardNumber + '`', inline:false },
          { name:'🔑 PIN',         value:'`' + card.pin + '`',        inline:true  },
          { name:'🏦 Linked To',   value:'Your bank balance',         inline:true  },
          { name:'💰 Bank Balance',value:fmtMoney(user.bank||0),      inline:true  },
        )
        .setFooter({ text:'Use /debit pay to spend from bank · /debit freeze if card is compromised' })
      ], ephemeral:true });
    }

    const card = getDebitCard(userId);
    if (!card) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription('No debit card. Create one with `/debit create`.')
    ], ephemeral:true });

    // ── VIEW ──────────────────────────────────────────────────
    if (sub === 'view') {
      const masked = card.cardNumber.replace(/\d{4}$/, '****');
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(card.frozen ? 0x3498db : 0x2ecc71)
        .setTitle(`💳 Your Debit Card${card.frozen ? ' ❄️ FROZEN' : ''}`)
        .addFields(
          { name:'💳 Card Number', value:'`' + card.cardNumber + '`', inline:false },
          { name:'🔑 PIN',         value:'`' + card.pin + '`',        inline:true  },
          { name:'💰 Bank Balance',value:fmtMoney(user.bank||0),      inline:true  },
          { name:'📅 Last Used',   value:card.lastUsed ? new Date(card.lastUsed).toLocaleDateString() : 'Never', inline:true },
          { name:'🔒 Status',      value:card.frozen ? '❄️ Frozen — no transactions allowed' : '✅ Active', inline:false },
        )
        .setFooter({ text:'Keep your card number private — hackers can use it to drain your bank' })
      ], ephemeral:true });
    }

    // ── FREEZE / UNFREEZE ─────────────────────────────────────
    if (sub === 'freeze') {
      card.frozen = true;
      await saveDebitCard(userId, card);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x3498db)
        .setTitle('❄️ Debit Card Frozen')
        .setDescription('No transactions can be made until you unfreeze with `/debit unfreeze`.')
      ], ephemeral:true });
    }
    if (sub === 'unfreeze') {
      card.frozen = false;
      await saveDebitCard(userId, card);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
        .setTitle('✅ Debit Card Unfrozen')
        .setDescription('Your card is active again.')
      ], ephemeral:true });
    }

    // ── PAY ───────────────────────────────────────────────────
    if (sub === 'pay') {
      if (card.frozen) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('❄️ Your debit card is frozen. Unfreeze it first with `/debit unfreeze`.')
      ], ephemeral:true });

      const amount = interaction.options.getInteger('amount');
      const note   = interaction.options.getString('note') || null;

      if ((user.bank||0) < amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Insufficient bank funds. You have **${fmtMoney(user.bank||0)}** in your bank.\n\nDebit pays directly from bank.`)
      ], ephemeral:true });

      user.bank -= amount;
      saveUser(userId, user);

      card.lastUsed = Date.now();
      card.transactions = [...(card.transactions||[]).slice(-19), { amount, note, at:Date.now() }];
      await saveDebitCard(userId, card);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('💳 Debit Payment Made')
        .setDescription(`**${fmtMoney(amount)}** deducted from your bank account.${note ? '\n\n📝 ' + note : ''}`)
        .addFields(
          { name:'🏦 New Bank Balance', value:fmtMoney(user.bank), inline:true },
          { name:'💳 Payment Method',   value:'Debit Card',          inline:true },
        )
      ]});
    }

    // ── DRAIN (HACKER) ────────────────────────────────────────
    if (sub === 'drain') {
      const cardNum = interaction.options.getString('card_number').trim();
      const amount  = interaction.options.getInteger('amount');
      const { getUserByCardNumber, getDebitCard: _gdc, saveDebitCard: _sdc } = require('../../utils/debitDb');

      const victimId = getUserByCardNumber(cardNum);
      if (!victimId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('Card number not found. Make sure you have the correct stolen number.')
      ], ephemeral:true });

      const victimCard = _gdc(victimId);
      if (!victimCard || victimCard.cardNumber !== cardNum) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Card invalid.')], ephemeral:true });
      if (victimCard.frozen) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('That card is frozen — you cannot drain it.')], ephemeral:true });

      const victim = getOrCreateUser(victimId);
      if ((victim.bank||0) < 100) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Victim has nothing in bank.')], ephemeral:true });

      const maxDrain = Math.floor((victim.bank||0) * 0.30); // max 30% per drain
      const drainAmt = Math.min(amount || maxDrain, maxDrain);

      victim.bank -= drainAmt;
      user.wallet += drainAmt;
      saveUser(victimId, victim);
      saveUser(userId, user);

      // Add heat for hacking
      try { const { addHeat } = require('../../utils/gangDb'); await addHeat(userId, 30, 'debit card fraud'); } catch {}

      // DM victim
      interaction.client.users.fetch(victimId).then(u2 => u2.send({ embeds:[new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle('🚨 Debit Card Fraud Alert!')
        .setDescription('Your debit card was used fraudulently. **' + fmtMoney(drainAmt) + '** was drained from your bank.\n\nFreeze your card immediately: /debit freeze')
      ]}).catch(()=>null)).catch(()=>null);

      victimCard.lastUsed = Date.now();
      await _sdc(victimId, victimCard);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('💳 Debit Card Drained!')
        .setDescription('Successfully drained **' + fmtMoney(drainAmt) + '** from the card owner bank.')
        .addFields(
          { name:'💰 Stolen',         value:fmtMoney(drainAmt), inline:true },
          { name:'💵 Your Wallet',    value:fmtMoney(user.wallet), inline:true },
          { name:'🔥 Heat Added',     value:'+30',               inline:true },
        )
        .setFooter({ text:'Victim has been notified. Lay low.' })
      ], ephemeral:true });
    }
  },
};
