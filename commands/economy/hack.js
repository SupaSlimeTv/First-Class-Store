// ============================================================
// commands/economy/hack.js — /hack
// Steal SSNs directly by hacking. Use /identity to act on them.
// ============================================================
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getUser, getStore } = require('../../utils/db');
const { getOrCreateCredit, saveCredit, getCreditTier } = require('../../utils/creditDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS }    = require('../../utils/embeds');

const fmtMoney  = n => '$' + Math.round(n).toLocaleString();
const HACK_CD   = new Map();
const HACK_MS   = 30 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hack')
    .setDescription('💻 Hack into someone\'s financial profile and steal their SSN.')
    .addSubcommand(s => s.setName('ssn')
      .setDescription('Attempt to steal a target\'s full SSN and credit profile')
      .addUserOption(o => o.setName('target').setDescription('Who to hack').setRequired(true))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const target = interaction.options.getUser('target');

    if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't hack yourself.")], ephemeral:true });
    if (target.bot)           return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't hack bots.")], ephemeral:true });

    const now = Date.now();
    const last = HACK_CD.get(userId) || 0;
    if (now - last < HACK_MS) {
      const mins = Math.ceil((HACK_MS - (now-last)) / 60000);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`💻 Hack cooldown: **${mins} min** remaining.`)
      ], ephemeral:true });
    }

    // ── SSN HACK ──────────────────────────────────────────────
    if (sub === 'ssn') {
      HACK_CD.set(userId, now);

      // Laptop with keylogger improves success
      const { getLaptop, hasApp } = require('../../utils/laptopDb');
      const laptop      = getLaptop(userId);
      const keylogger   = laptop?.apps?.find(a => a.id === 'keylogger');
      const keyBonus    = keylogger ? 0.20 : 0;

      const victimUser   = getUser(target.id);
      const hasShield    = (victimUser?.inventory||[]).includes('identity_shield');
      const baseChance   = hasShield ? 0.15 : 0.45;
      const finalChance  = Math.min(0.90, baseChance + keyBonus);
      const success      = Math.random() < finalChance;

      if (!success) {
        if (hasShield) {
          target.send({ embeds:[new EmbedBuilder().setColor(0xff8800)
            .setTitle('🛡️ Hack Attempt Blocked!')
            .setDescription('Your **Identity Shield** blocked a hack attempt on your SSN.')
          ]}).catch(()=>{});
        }
        return interaction.reply({ embeds:[new EmbedBuilder()
          .setColor(COLORS.ERROR)
          .setTitle('💻 Hack Failed')
          .setDescription(`Couldn't breach <@${target.id}>'s security.${hasShield ? '\n\n🛡️ They had an **Identity Shield** active.' : '\n\nTry again after cooldown, or use `/laptop run app:ssn_scanner` for better odds.'}`)
        ], ephemeral:true });
      }

      // Store stolen SSN on the hacker's credit profile
      const hackerCredit = await getOrCreateCredit(userId);
      const victimCredit = await getOrCreateCredit(target.id);
      if (!hackerCredit.ssnStolen) hackerCredit.ssnStolen = {};
      hackerCredit.ssnStolen[target.id] = {
        ssn:    victimCredit.ssn,
        score:  victimCredit.score,
        at:     now,
        source: 'hack',
        partial: false,
      };
      await saveCredit(userId, hackerCredit);

      try { const { addHeat } = require('../../utils/gangDb'); await addHeat(userId, 20, 'identity hack'); } catch {}

      // Delayed DM to victim — simulates real identity theft discovery
      setTimeout(() => {
        target.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
          .setTitle('⚠️ Suspicious Activity Detected')
          .setDescription('Your financial monitoring service flagged unusual activity.\n\nCheck `/credit check` immediately. You may be a victim of identity theft.')
        ]}).catch(()=>{});
      }, 5 * 60 * 1000);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('💻 Hack Successful — SSN Stolen')
        .setDescription(
          `Breached <@${target.id}>'s financial profile.\n\n` +
          `🪪 SSN: \`${victimCredit.ssn}\`\n` +
          `📊 Score: **${victimCredit.score}** (${getCreditTier(victimCredit.score).label})\n\n` +
          `SSN saved to your stash. Use:\n` +
          `• \`/identity balance\` — check their money\n` +
          `• \`/identity fraud\` — open a card on their identity\n` +
          `• \`/identity drain\` — drain their existing card\n` +
          `• \`/tor sell\` — list it on the dark web for profit`
        )
      ], ephemeral:true });
    }
  },
};
