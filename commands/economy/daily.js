const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { dailyEmbed, errorEmbed } = require('../../utils/embeds');
const { noAccount } = require('../../utils/accountCheck');

const DAILY_AMOUNT = 500;
const COOLDOWN_MS  = 24 * 60 * 60 * 1000;
const GRACE_MS     = 6 * 60 * 60 * 1000; // 6 hour grace to not break streak

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily reward. Streak bonuses for consecutive days!'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const user = getOrCreateUser(interaction.user.id);
    const now  = Date.now();

    if (user.lastDaily) {
      const since = now - user.lastDaily;
      if (since < COOLDOWN_MS) {
        const left = COOLDOWN_MS - since;
        const h = Math.floor(left / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        return interaction.reply({ embeds: [errorEmbed(`You already claimed your daily!\n⏰ Come back in **${h}h ${m}m**`)], ephemeral: true });
      }
      // Break streak if more than 48h + grace
      if (since > COOLDOWN_MS * 2 + GRACE_MS) {
        user.dailyStreak = 0;
      }
    }

    if (!user.dailyStreak) user.dailyStreak = 0;
    user.dailyStreak++;

    // Streak multipliers
    let mult   = 1;
    let bonus  = '';
    if (user.dailyStreak >= 30) { mult = 3;   bonus = '🔥🔥🔥 30-day streak — 3× bonus!'; }
    else if (user.dailyStreak >= 14) { mult = 2.5; bonus = '🔥🔥 14-day streak — 2.5× bonus!'; }
    else if (user.dailyStreak >= 7)  { mult = 2;   bonus = '🔥 7-day streak — 2× bonus!'; }
    else if (user.dailyStreak >= 3)  { mult = 1.5; bonus = '✨ 3-day streak — 1.5× bonus!'; }

    const earned    = Math.floor(DAILY_AMOUNT * mult);
    user.wallet    += earned;
    user.lastDaily  = now;
    saveUser(interaction.user.id, user);

    const embed = new EmbedBuilder()
      .setColor(0xf5c518)
      .setTitle('📅 Daily Reward Claimed!')
      .setDescription(`You received **$${earned.toLocaleString()}**!${bonus ? `\n\n${bonus}` : ''}`)
      .addFields(
        { name: '💵 Wallet',    value: `$${user.wallet.toLocaleString()}`, inline: true },
        { name: '🔥 Streak',    value: `${user.dailyStreak} day${user.dailyStreak !== 1 ? 's' : ''}`, inline: true },
      )
      .setFooter({ text: 'Claim every day to keep your streak!' });

    await interaction.reply({ embeds: [embed] });
  },
};
