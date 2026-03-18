// ============================================================
// commands/economy/use.js
// Slash command: /use <item_id> [target]
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getOrCreateUser, removeItem, getStore, isBotBanned, saveUser } = require('../../utils/db');
const { executeEffect } = require('../../utils/effects');
const { errorEmbed, COLORS } = require('../../utils/embeds');
const { isRestricted } = require('../../utils/permissions');
const { generateChallenge } = require('../../utils/minigames');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Use an item from your inventory.')
    .addStringOption((o) =>
      o.setName('item_id').setDescription('The item ID to use (from /shop inventory)').setRequired(true)
    )
    .addUserOption((o) =>
      o.setName('target').setDescription('Target user (required for attack items)').setRequired(false)
    ),

  async execute(interaction) {
    // Bot-ban check
    if (isBotBanned(interaction.user.id)) {
      const u = getOrCreateUser(interaction.user.id);
      const mins = Math.ceil((u.bannedUntil - Date.now()) / 60000);
      return interaction.reply({
        embeds: [errorEmbed(`🔇 You're silenced. **${mins}m** remaining.`)],
        ephemeral: true,
      });
    }

    const itemId     = interaction.options.getString('item_id').toLowerCase();
    const targetUser = interaction.options.getUser('target');
    const userId     = interaction.user.id;

    // ---- Check inventory ----
    const user = getUser(userId);
    if (!user) {
      return interaction.reply({
        embeds: [errorEmbed("You don't have an account yet! Type `!open account` to get started.")],
        ephemeral: true,
      });
    }

    const inv = user.inventory || [];
    if (!inv.includes(itemId)) {
      return interaction.reply({
        embeds: [errorEmbed(`You don't have **${itemId}** in your inventory.\nBuy it with \`/shop buy ${itemId}\``)],
        ephemeral: true,
      });
    }

    // ---- Look up item ----
    const store = getStore();
    const item  = store.items.find((i) => i.id === itemId);

    if (!item) return interaction.reply({ embeds: [errorEmbed(`Item \`${itemId}\` no longer exists.`)], ephemeral: true });
    if (item.type !== 'useable') return interaction.reply({ embeds: [errorEmbed(`**${item.name}** is not a useable item.`)], ephemeral: true });

    // ---- Target validation ----
    const targetId = targetUser?.id || null;
    const allAttackTypes = ['drain_wallet', 'drain_all', 'silence', 'hitman', 'minigame_drain'];

    if (targetId && item.effect && allAttackTypes.includes(item.effect.type)) {
      if (isRestricted(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed("You don't have permission to use attack items.")], ephemeral: true });
      }
    }

    if ((item.effect?.type === 'hitman' || item.effect?.type === 'minigame_drain') && !targetId) {
      return interaction.reply({ embeds: [errorEmbed(`This item requires a target.\nUsage: \`/use ${itemId} target:@user\``)], ephemeral: true });
    }

    const selfBlockTypes = ['drain_wallet', 'drain_all', 'silence', 'minigame_drain'];
    if (targetId === userId && item.effect && selfBlockTypes.includes(item.effect.type)) {
      return interaction.reply({ embeds: [errorEmbed("You can't use this item on yourself.")], ephemeral: true });
    }

    if (targetId && targetUser?.bot) return interaction.reply({ embeds: [errorEmbed("You can't target a bot.")], ephemeral: true });

    // Defer
    await interaction.deferReply();

    // Consume item
    if (!item.reusable) removeItem(userId, itemId);

    // Fetch target member for role checks
    let targetMember = null;
    if (targetId) targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);

    // ---- Execute effect ----
    const result = await executeEffect(item, userId, targetId, targetMember);

    // ---- MINIGAME FLOW ----
    if (result.needsMinigame) {
      const effect   = result.effect;
      const timeLimit = (effect.timeLimitSeconds || 30) * 1000;
      const { word, scrambled } = generateChallenge();

      // Show the challenge
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00d2ff)
            .setTitle(`💻 ${item.name} — Hack Initiated!`)
            .setDescription(
              `You've targeted <@${targetId}>.\n\n` +
              `**Unscramble this word to complete the hack:**\n\n` +
              `## \`${scrambled}\`\n\n` +
              `Type the correct word in this channel within **${effect.timeLimitSeconds || 30} seconds**.\n` +
              `Fail and you'll be fined **${effect.finePercent || 10}%** of your balance.`
            )
            .setFooter({ text: `${word.length} letters` })
            .setTimestamp(),
        ],
      });

      // Wait for their answer
      const filter = (m) => m.author.id === userId && m.channelId === interaction.channelId;
      let collected;
      try {
        collected = await interaction.channel.awaitMessages({ filter, max: 1, time: timeLimit, errors: ['time'] });
      } catch {
        // Time ran out
        const attacker = getOrCreateUser(userId);
        const fine     = Math.floor((attacker.wallet + attacker.bank) * ((effect.finePercent || 10) / 100));
        const fromWallet = Math.min(fine, attacker.wallet);
        const fromBank   = Math.min(fine - fromWallet, attacker.bank);
        attacker.wallet -= fromWallet;
        attacker.bank    = Math.max(0, attacker.bank - fromBank);
        saveUser(userId, attacker);

        return interaction.followUp({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.ERROR)
              .setTitle('⏰ Time\'s Up — Hack Failed!')
              .setDescription(
                `You ran out of time! The word was **${word}**.\n\n` +
                `You were fined **$${fine.toLocaleString()}** for the failed attempt.`
              )
              .addFields(
                { name: '💵 Wallet', value: `$${attacker.wallet.toLocaleString()}`, inline: true },
                { name: '🏦 Bank',   value: `$${attacker.bank.toLocaleString()}`,   inline: true },
              ),
          ],
        });
      }

      const answer = collected.first().content.trim().toLowerCase();

      if (answer === word) {
        // ---- SUCCESS — execute the drain ----
        const targetData = getOrCreateUser(targetId);
        let stolen = 0;

        if (effect.drainTarget === 'bank' || effect.drainTarget === 'both') {
          const bankAmount = effect.drainType === 'percent'
            ? Math.floor(targetData.bank * (effect.amount / 100))
            : Math.min(effect.amount, targetData.bank);
          targetData.bank -= bankAmount;
          stolen += bankAmount;
        }
        if (effect.drainTarget === 'wallet' || effect.drainTarget === 'both') {
          const walletAmount = effect.drainType === 'percent'
            ? Math.floor(targetData.wallet * (effect.amount / 100))
            : Math.min(effect.amount, targetData.wallet);
          targetData.wallet -= walletAmount;
          stolen += walletAmount;
        }

        const attacker = getOrCreateUser(userId);
        attacker.wallet += stolen;
        saveUser(targetId, targetData);
        saveUser(userId, attacker);

        // Try to delete their answer message to keep things clean
        collected.first().delete().catch(() => {});

        await interaction.followUp({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.SUCCESS)
              .setTitle('✅ Hack Successful!')
              .setDescription(
                `You unscrambled **${word}** and drained <@${targetId}>!\n` +
                `You stole **$${stolen.toLocaleString()}**.`
              )
              .addFields(
                { name: '💰 Stolen',    value: `$${stolen.toLocaleString()}`,        inline: true },
                { name: '💵 Your Wallet', value: `$${attacker.wallet.toLocaleString()}`, inline: true },
              ),
          ],
        });

        // DM target
        try {
          await targetUser.send(`💻 You were hacked in **${interaction.guild.name}**! **$${stolen.toLocaleString()}** was drained from your account.`);
        } catch { /* DMs closed */ }

      } else {
        // ---- WRONG ANSWER — fine the attacker ----
        const attacker  = getOrCreateUser(userId);
        const fine      = Math.floor((attacker.wallet + attacker.bank) * ((effect.finePercent || 10) / 100));
        const fromWallet = Math.min(fine, attacker.wallet);
        const fromBank   = Math.min(fine - fromWallet, attacker.bank);
        attacker.wallet -= fromWallet;
        attacker.bank    = Math.max(0, attacker.bank - fromBank);
        saveUser(userId, attacker);

        collected.first().delete().catch(() => {});

        await interaction.followUp({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.ERROR)
              .setTitle('❌ Wrong Answer — Hack Failed!')
              .setDescription(
                `Incorrect! The word was **${word}**.\n\n` +
                `You were fined **$${fine.toLocaleString()}** for the failed hack.`
              )
              .addFields(
                { name: '💵 Wallet', value: `$${attacker.wallet.toLocaleString()}`, inline: true },
                { name: '🏦 Bank',   value: `$${attacker.bank.toLocaleString()}`,   inline: true },
              ),
          ],
        });
      }

      return;
    }

    // ---- NORMAL EFFECT FLOW ----
    const embed = new EmbedBuilder()
      .setColor(result.success ? COLORS.SUCCESS : COLORS.ERROR)
      .setTitle(result.title)
      .setDescription(result.description)
      .setTimestamp();

    if (result.fields) embed.addFields(result.fields);
    embed.setFooter({ text: `${item.name} — ${item.reusable ? '♻️ Reusable' : '🗑️ Single-use'}` });

    await interaction.editReply({ embeds: [embed] });

    // DM target if attacked
    const attackTypes = ['drain_wallet', 'drain_all', 'silence', 'hitman'];
    if (targetId && result.success && item.effect && attackTypes.includes(item.effect.type)) {
      try {
        await targetUser.send(`⚠️ You were hit by **${item.name}** in **${interaction.guild.name}**!\n${result.description}`);
      } catch { /* DMs closed */ }
    }
  },
};
