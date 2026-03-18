// ============================================================
// utils/accountCheck.js
// Reusable account check for slash commands
// ============================================================
const { getUser } = require('./db');
const { EmbedBuilder } = require('discord.js');

const NO_ACCOUNT_COLOR = 0xff3b3b;

/**
 * Checks if a user has an account. If not, replies with a clear
 * instruction embed and returns true (so the command can return early).
 * Usage: if (await noAccount(interaction)) return;
 */
async function noAccount(interaction) {
  const user = getUser(interaction.user.id);
  if (!user) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(NO_ACCOUNT_COLOR)
          .setTitle('🏦 No Account Found')
          .setDescription(
            `You don't have an account yet!\n\n` +
            `Type **\`!open account\`** in any channel to get started.\n` +
            `You'll receive **$500** to begin playing.`
          )
          .setFooter({ text: 'Use your server prefix if it\'s different from !' })
      ],
      ephemeral: true,
    });
    return true;
  }
  return false;
}

module.exports = { noAccount };
