// ============================================================
// commands/economy/use.js
// Slash command: /use <item_id> [target]
//
// Consumes a useable item from inventory and fires its effect.
// The effect engine (utils/effects.js) handles all the logic.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, removeItem, getStore, isBotBanned } = require('../../utils/db');
const { executeEffect } = require('../../utils/effects');
const { errorEmbed, COLORS } = require('../../utils/embeds');
const { isRestricted } = require('../../utils/permissions');

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
      const u = getUser(interaction.user.id);
      const mins = Math.ceil((u.bannedUntil - Date.now()) / 60000);
      return interaction.reply({
        embeds: [errorEmbed(`🔇 You're silenced. **${mins}m** remaining.`)],
        ephemeral: true,
      });
    }

    const itemId   = interaction.options.getString('item_id').toLowerCase();
    const targetUser = interaction.options.getUser('target');
    const userId   = interaction.user.id;

    // ---- Check inventory ----
    const user = getUser(userId);
    const inv  = user.inventory || [];

    if (!inv.includes(itemId)) {
      return interaction.reply({
        embeds: [errorEmbed(`You don't have **${itemId}** in your inventory.\nBuy it with \`/shop buy ${itemId}\``)],
        ephemeral: true,
      });
    }

    // ---- Look up item definition ----
    const store = getStore();
    const item  = store.items.find((i) => i.id === itemId);

    if (!item) {
      return interaction.reply({
        embeds: [errorEmbed(`Item \`${itemId}\` no longer exists in the store.`)],
        ephemeral: true,
      });
    }

    if (item.type !== 'useable') {
      return interaction.reply({
        embeds: [errorEmbed(`**${item.name}** is not a useable item.`)],
        ephemeral: true,
      });
    }

    // ---- Target validation ----
    const targetId = targetUser?.id || null;

    // If item attacks another user, check restricted role
    const attackTypes = ['drain_wallet', 'drain_all', 'silence', 'hitman'];
    if (targetId && item.effect && attackTypes.includes(item.effect.type)) {
      if (isRestricted(interaction.member)) {
        return interaction.reply({
          embeds: [errorEmbed("You don't have permission to use attack items on other users.")],
          ephemeral: true,
        });
      }
    }

    // Hitman specifically requires a target
    if (item.effect?.type === 'hitman' && !targetId) {
      return interaction.reply({
        embeds: [errorEmbed('You must choose a target to deploy the hitman against.\nUsage: `/use hitman target:@user`')],
        ephemeral: true,
      });
    }

    if (targetId === userId) {
      // Allow self-targeting for shield/passive — block it for drain/silence
      const selfBlockTypes = ['drain_wallet', 'drain_all', 'silence'];
      if (item.effect && selfBlockTypes.includes(item.effect.type)) {
        return interaction.reply({
          embeds: [errorEmbed('You can\'t use this item on yourself.')],
          ephemeral: true,
        });
      }
    }

    if (targetId && targetUser?.bot) {
      return interaction.reply({ embeds: [errorEmbed('You can\'t target a bot.')], ephemeral: true });
    }

    // Defer — effect execution might take a moment
    await interaction.deferReply();

    // ---- Consume the item only if single-use ----
    if (!item.reusable) {
      removeItem(userId, itemId);
    }

    // Fetch target guild member for role checks
    let targetMember = null;
    if (targetId) {
      targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    }

    // ---- Execute the effect ----
    const result = await executeEffect(item, userId, targetId, targetMember);

    // ---- Build result embed ----
    const embed = new EmbedBuilder()
      .setColor(result.success ? COLORS.SUCCESS : COLORS.ERROR)
      .setTitle(result.title)
      .setDescription(result.description)
      .setTimestamp();

    if (result.fields) {
      embed.addFields(result.fields);
    }

    embed.setFooter({ text: `${item.name} — ${item.reusable ? '♻️ Reusable' : '🗑️ Single-use'}` });

    await interaction.editReply({ embeds: [embed] });

    // ---- DM the target if attacked ----
  
    if (targetId && result.success && item.effect && attackTypes.includes(item.effect.type)) {
      try {
        await targetUser.send(
          `⚠️ You were hit by **${item.name}** in **${interaction.guild.name}**!\n${result.description}`
        );
      } catch { /* DMs closed */ }
    }
  },
};
