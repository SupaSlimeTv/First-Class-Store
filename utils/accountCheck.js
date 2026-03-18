// ============================================================
// utils/accountCheck.js
// Reusable account check for slash commands
// ============================================================
const { getUser } = require('./db');
const { errorEmbed } = require('./embeds');

/**
 * Checks if a user has an account. If not, replies with an error and returns true.
 * Usage: if (await noAccount(interaction)) return;
 */
async function noAccount(interaction) {
  const user = getUser(interaction.user.id);
  if (!user) {
    await interaction.reply({
      embeds: [errorEmbed(`You don't have an account yet!\nType \`!open account\` (or your server prefix) to get started.`)],
      ephemeral: true,
    });
    return true;
  }
  return false;
}

module.exports = { noAccount };
