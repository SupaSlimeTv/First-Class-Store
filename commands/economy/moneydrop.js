// ============================================================
// commands/economy/moneydrop.js — /moneydrop admin command
// Triggers a manual drop. Auto-drops handled in index.js.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moneydrop')
    .setDescription('💸 Manually trigger a money drop (admin only)')
    .addIntegerOption(o => o.setName('amount').setDescription('Custom amount (leave blank for random, max $485k)').setRequired(false).setMinValue(100).setMaxValue(485000))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to drop in (default: current)').setRequired(false)),

  async execute(interaction) {
    if (!interaction.member.permissions.has('ManageGuild') && !interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Admins only.')], ephemeral:true });
    }

    const amount  = interaction.options.getInteger('amount') || null;
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    // Trigger the drop system built into index.js
    const { spawnMoneyDropInChannel } = require('../../index.js').dropHelpers || {};

    if (typeof spawnMoneyDropInChannel === 'function') {
      await interaction.reply({ content:`💸 Drop spawned in ${channel}!`, ephemeral:true });
      await spawnMoneyDropInChannel(channel, amount);
    } else {
      // Fallback: use the inline method
      await interaction.reply({ content:`💸 Drop spawned in ${channel}!`, ephemeral:true });
      // The bot's main drop function will handle it via the shared spawnMoneyDrop
      const { getConfig } = require('../../utils/db');
      const origChannel = getConfig(interaction.guildId).moneyDropChannelId;

      // Temporarily set channel and trigger, then restore
      const { saveConfig } = require('../../utils/db');
      const config = getConfig(interaction.guildId);
      config.moneyDropChannelId = channel.id;
      saveConfig(interaction.guildId, config);

      // Import and call the main drop spawner
      try {
        const indexModule = require('../../index.js');
        if (indexModule._spawnMoneyDrop) {
          await indexModule._spawnMoneyDrop(interaction.guild, amount);
        }
      } catch {}
    }
  },
};
