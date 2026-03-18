const { SlashCommandBuilder } = require('discord.js');
const { getUser, saveUser } = require('../../utils/db');
const { dailyEmbed, errorEmbed } = require('../../utils/embeds');

const DAILY_AMOUNT = 500;
const COOLDOWN_MS  = 24 * 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily $500 reward.'),

  async execute(interaction) {
    const user = getUser(interaction.user.id);
    const now  = Date.now();

    if (user.lastDaily) {
      const left = COOLDOWN_MS - (now - user.lastDaily);
      if (left > 0) {
        const h = Math.floor(left / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        return interaction.reply({ embeds: [errorEmbed(`You already claimed your daily!\n⏰ Come back in **${h}h ${m}m**`)], ephemeral: true });
      }
    }

    user.wallet   += DAILY_AMOUNT;
    user.lastDaily = now;
    saveUser(interaction.user.id, user);

    await interaction.reply({ embeds: [dailyEmbed(DAILY_AMOUNT, user.wallet)] });
  },
};
