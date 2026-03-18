// ============================================================
// utils/accountCheck.js
// Reusable account check for slash commands
// ============================================================
const { getUser, getConfig } = require('./db');
const { EmbedBuilder } = require('discord.js');

async function noAccount(interaction) {
  const user = getUser(interaction.user.id);
  if (!user) {
    const prefix = getConfig().prefix || '!';
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff3b3b)
          .setTitle('🏦 No Account Found')
          .setDescription(
            `<@${interaction.user.id}> you don't have an account yet!\n\n` +
            `Type **\`${prefix}open account\`** in any channel to get started.\n` +
            `You'll receive **$500** to begin playing.`
          )
      ],
      ephemeral: true,
    });
    return true;
  }
  return false;
}

module.exports = { noAccount };
