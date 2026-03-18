// ============================================================
// commands/economy/collect.js
// Slash command: /collect
//
// Lets users collect their role-based income.
// Each role has its own amount, location (wallet/bank), and cooldown.
// Users can only collect income for roles they actually have.
// Multiple roles stack — each pays out separately.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getOrCreateUser, saveUser, getConfig, isBotBanned } = require('../../utils/db');
const { errorEmbed, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('collect')
    .setDescription('Collect your role-based income.'),

  async execute(interaction) {
    // Bot-ban check
    if (isBotBanned(interaction.user.id)) {
      const u    = getUser(interaction.user.id);
      const mins = Math.ceil((u.bannedUntil - Date.now()) / 60000);
      return interaction.reply({
        embeds: [errorEmbed(`🔇 You're silenced. **${mins}m** remaining.`)],
        ephemeral: true,
      });
    }

    const config      = getConfig();
    const roleIncome  = config.roleIncome || {};
    const now         = Date.now();

    // Get all role IDs this member actually has
    const memberRoleIds = interaction.member.roles.cache.map(r => r.id);

    // Find which income roles this user qualifies for
    const eligible = Object.entries(roleIncome).filter(([roleId]) =>
      memberRoleIds.includes(roleId)
    );

    if (!eligible.length) {
      return interaction.reply({
        embeds: [errorEmbed("You don't have any roles that earn income.\nAsk the server owner to set up role income.")],
        ephemeral: true,
      });
    }

    const user = getUser(interaction.user.id);
    if (!user.roleIncomeCooldowns) user.roleIncomeCooldowns = {};

    const collected = []; // roles successfully collected
    const onCooldown = []; // roles still on cooldown

    for (const [roleId, income] of eligible) {
      const intervalMs  = (income.intervalHours || 24) * 60 * 60 * 1000;
      const lastCollect = user.roleIncomeCooldowns[roleId] || 0;
      const elapsed     = now - lastCollect;

      if (elapsed < intervalMs) {
        // Still on cooldown
        const remaining   = intervalMs - elapsed;
        const hoursLeft   = Math.floor(remaining / 3600000);
        const minutesLeft = Math.floor((remaining % 3600000) / 60000);
        onCooldown.push({ income, hoursLeft, minutesLeft });
        continue;
      }

      // Pay out — add to wallet or bank
      if (income.location === 'bank') {
        user.bank += income.amount;
      } else {
        user.wallet += income.amount;
      }

      // Update cooldown timestamp
      user.roleIncomeCooldowns[roleId] = now;
      collected.push(income);
    }

    saveUser(interaction.user.id, user);

    // ---- BUILD RESPONSE EMBED ----
    if (!collected.length && onCooldown.length) {
      // Nothing collected — all on cooldown
      const lines = onCooldown.map(({ income, hoursLeft, minutesLeft }) =>
        `**${income.name}** — ⏰ ${hoursLeft}h ${minutesLeft}m remaining`
      );
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.WARNING)
            .setTitle('⏰ Nothing to Collect Yet')
            .setDescription(lines.join('\n'))
            .setFooter({ text: 'Come back when your cooldowns reset' })
            .setTimestamp(),
        ],
        ephemeral: true,
      });
    }

    // Build collected lines
    const collectedLines = collected.map(income =>
      `✅ **${income.name}** — **$${income.amount.toLocaleString()}** → ${income.location === 'bank' ? '🏦 Bank' : '💵 Wallet'}`
    );

    // Build cooldown lines (if some were ready and some weren't)
    const cooldownLines = onCooldown.map(({ income, hoursLeft, minutesLeft }) =>
      `⏰ **${income.name}** — ${hoursLeft}h ${minutesLeft}m remaining`
    );

    const embed = new EmbedBuilder()
      .setColor(COLORS.DAILY)
      .setTitle('💼 Income Collected!')
      .setDescription(collectedLines.join('\n'))
      .addFields(
        { name: '💵 Wallet', value: `**$${user.wallet.toLocaleString()}**`, inline: true },
        { name: '🏦 Bank',   value: `**$${user.bank.toLocaleString()}**`,   inline: true },
      )
      .setTimestamp();

    if (cooldownLines.length) {
      embed.addFields({ name: 'Still on Cooldown', value: cooldownLines.join('\n'), inline: false });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
