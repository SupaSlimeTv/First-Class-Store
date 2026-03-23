// ============================================================
// commands/gangs/gangpayroll.js — /gangpayroll
// Gang leaders propose payroll deals to police officers.
// Officer accepts/declines via button DM.
// Active deals: officer looks the other way (30% evasion).
// Requires: gang must have police_payroll upgrade level 1+
// ============================================================

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGangByMember, getGang, saveGang } = require('../../utils/gangDb');
const { isOfficer, getOfficer, updateOfficer } = require('../../utils/policeDb');
const { getOrCreateUser, saveUser, getConfig } = require('../../utils/db');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();

// In-memory pending offers: offerId -> { gangId, leaderId, officerId, amount, expiresAt }
const _pendingOffers = {};

function getPayrollKey(gangId, officerId) { return `${gangId}:${officerId}`; }

module.exports = {
  _pendingOffers, // exported so police.js can check it

  data: new SlashCommandBuilder()
    .setName('gangpayroll')
    .setDescription('Manage police officer payroll deals for your gang.')
    .addSubcommand(s => s.setName('offer')
      .setDescription('Propose a payroll deal to a police officer')
      .addUserOption(o => o.setName('officer').setDescription('Officer to bribe').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('One-time payment for the deal').setRequired(true).setMinValue(1000)))
    .addSubcommand(s => s.setName('view')
      .setDescription('View active payroll deals for your gang'))
    .addSubcommand(s => s.setName('cut')
      .setDescription('Cut an officer off payroll')
      .addUserOption(o => o.setName('officer').setDescription('Officer to remove').setRequired(true))),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const guildId= interaction.guildId;

    // Must be a gang leader
    const gang = getGangByMember(userId);
    if (!gang)             return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You're not in a gang.")], ephemeral:true });
    if (gang.leaderId !== userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Only the **gang leader** can manage payroll.')], ephemeral:true });

    // Must have police_payroll upgrade
    if (!gang.police_payroll || gang.police_payroll < 1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setTitle('🔒 Upgrade Required')
      .setDescription('Your gang needs the **Police on Payroll** upgrade (via `/gangupgrade`) before you can offer deals to officers.')
    ], ephemeral:true });

    // ── OFFER ─────────────────────────────────────────────────
    if (sub === 'offer') {
      const target = interaction.options.getUser('officer');
      const amount = interaction.options.getInteger('amount');

      if (!isOfficer(guildId, target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`<@${target.id}> is not a police officer in this server.`)
      ], ephemeral:true });

      // Check leader has enough in wallet
      const leader = getOrCreateUser(userId);
      if (leader.wallet < amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You need **${fmtMoney(amount)}** in your wallet to make this offer.`)
      ], ephemeral:true });

      // Check no existing deal
      const payrolls = gang.payrolls || {};
      const key = getPayrollKey(gang.id, target.id);
      if (payrolls[key]) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`<@${target.id}> is already on your payroll. Cut them first before making a new offer.`)
      ], ephemeral:true });

      // Hold the money while offer is pending
      leader.wallet -= amount;
      saveUser(userId, leader);

      // Store pending offer
      const offerId = `${gang.id}_${target.id}_${Date.now()}`;
      _pendingOffers[offerId] = { gangId: gang.id, leaderId: userId, officerId: target.id, amount, guildId, expiresAt: Date.now() + 5 * 60 * 1000 };

      // Build DM to officer
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`payroll_accept_${offerId}`).setLabel(`✅ Accept ${fmtMoney(amount)}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`payroll_decline_${offerId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
      );

      try {
        await target.send({ embeds:[new EmbedBuilder()
          .setColor(0xf5c518)
          .setTitle('💰 Gang Payroll Offer')
          .setDescription(`**${interaction.guild.name}** — <@${userId}> (Gang Leader of **${gang.name}**) is offering you a payroll deal.\n\n💵 **Payment: ${fmtMoney(amount)}**\n\n**What you agree to:**\n→ Look the other way on gang members\n→ Your credibility drops **-15**\n→ This is logged in the server audit\n\n⚠️ Offer expires in 5 minutes.`)
          .setFooter({ text: `Gang: ${gang.name}` })
        ], components:[row] });
      } catch {
        // Can't DM — refund
        leader.wallet += amount;
        saveUser(userId, leader);
        delete _pendingOffers[offerId];
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`Can't DM <@${target.id}>. They may have DMs off. Money refunded.`)
        ], ephemeral:true });
      }

      // Auto-expire offer and refund after 5min
      setTimeout(() => {
        if (_pendingOffers[offerId]) {
          delete _pendingOffers[offerId];
          const l = getOrCreateUser(userId);
          l.wallet += amount;
          saveUser(userId, l);
        }
      }, 5 * 60 * 1000);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('💰 Payroll Offer Sent')
        .setDescription(`Offer of **${fmtMoney(amount)}** sent to <@${target.id}>.\n\n**${fmtMoney(amount)}** held from your wallet. Refunded if declined or expires.`)
      ], ephemeral:true });
    }

    // ── VIEW ──────────────────────────────────────────────────
    if (sub === 'view') {
      const payrolls = gang.payrolls || {};
      const deals    = Object.values(payrolls);

      if (!deals.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888)
        .setTitle(`👮 ${gang.name} — Police Payroll`)
        .setDescription('No active payroll deals.\n\nUse `/gangpayroll offer @officer amount:` to propose a deal.')
      ], ephemeral:true });

      const lines = deals.map(d =>
        `<@${d.officerId}> — paid **${fmtMoney(d.amount)}** on <t:${Math.floor(d.dealtAt/1000)}:D>`
      ).join('\n');

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`👮 ${gang.name} — Police Payroll`)
        .setDescription(`**${deals.length} officer${deals.length!==1?'s':''} on payroll:**\n\n${lines}\n\n🛡️ Gang members have a **30% chance** to evade any search by a non-payrolled officer.\n✅ Payrolled officers are **blocked** from searching your members.`)
        .setFooter({ text:`Payroll level: ${gang.police_payroll}/5` })
      ], ephemeral:true });
    }

    // ── CUT ───────────────────────────────────────────────────
    if (sub === 'cut') {
      const target   = interaction.options.getUser('officer');
      const payrolls = gang.payrolls || {};
      const key      = getPayrollKey(gang.id, target.id);

      if (!payrolls[key]) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`<@${target.id}> is not on your payroll.`)
      ], ephemeral:true });

      delete payrolls[key];
      gang.payrolls = payrolls;
      await saveGang(gang.id, gang);

      // Notify the officer
      target.send({ embeds:[new EmbedBuilder().setColor(0x888888)
        .setDescription(`Your payroll deal with **${gang.name}** has been terminated.`)
      ]}).catch(()=>{});

      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
        .setDescription(`<@${target.id}> has been removed from **${gang.name}**'s payroll.`)
      ], ephemeral:true });
    }
  },
};
