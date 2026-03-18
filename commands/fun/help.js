// commands/fun/help.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('See all available commands.'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle('📖 Bot Commands')
      .setTimestamp()
      .addFields(
        {
          name: '💰 Economy',
          value: [
            '`/balance [user]` — Check wallet & bank',
            '`/daily` — Claim $500 daily reward',
            '`/deposit <amount|all>` — Move wallet → bank',
            '`/withdraw <amount|all>` — Move bank → wallet',
            '`/rob <user>` — Steal from someone\'s wallet',
          ].join('\n'),
        },
        {
          name: '🎮 Games',
          value: [
            '`/coinflip <bet> <heads|tails>` — 50/50 bet',
            '`/blackjack <bet>` — Beat the dealer',
            '`/roulette <bet> <type>` — Spin the wheel',
          ].join('\n'),
        },
        {
          name: '🎉 Fun',
          value: [
            '`/8ball <question>` — Magic 8-ball',
            '`/roll [sides]` — Roll a dice',
            '`/rps <choice>` — Rock Paper Scissors',
          ].join('\n'),
        },
        {
          name: '🔨 Moderation',
          value: [
            '`/kick <user>` — Kick a member',
            '`/ban <user>` — Ban a member',
            '`/mute <user> <minutes>` — Timeout a member',
            '`/warn <user> <reason>` — Warn a member',
            '`/setmodrole <role> [perms]` — Assign mod permissions *(Admin)*',
            '`/purge <start|end>` — Activate the purge *(Purge role)*',
          ].join('\n'),
        },
        {
          name: '🔴 Purge Mode',
          value: [
            'When active:',
            '• All bank funds moved to wallets',
            '• Deposits & withdrawals disabled',
            '• Rob cooldown removed',
          ].join('\n'),
        }
      );

    await interaction.reply({ embeds: [embed] });
  },
};
