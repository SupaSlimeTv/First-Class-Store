const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const RESPONSES_WIN = [
  { msg: 'A stranger felt bad for you.', emoji: '🤲' },
  { msg: 'Someone tossed you a coin.', emoji: '🪙' },
  { msg: 'A kind soul opened their wallet.', emoji: '💝' },
  { msg: 'You held a sad sign. It worked.', emoji: '🪧' },
  { msg: 'Someone dropped their change near you.', emoji: '🤑' },
];
const RESPONSES_LOSE = [
  { msg: 'Everyone walked past you.', emoji: '😐' },
  { msg: 'Someone lectured you about crypto instead.', emoji: '😤' },
  { msg: 'A pigeon stole your cup.', emoji: '🐦' },
  { msg: 'You got a pamphlet instead of money.', emoji: '📄' },
];
const RESPONSES_FINE = [
  { msg: 'A cop fined you for loitering.', emoji: '👮' },
  { msg: 'You tripped and dropped your wallet.', emoji: '😬' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('beg')
    .setDescription('Beg for money. No cooldown but risky.'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const user = getOrCreateUser(interaction.user.id);
    const roll = Math.random();

    let earned = 0, color = COLORS.SUCCESS, response;

    if (roll < 0.55) {
      // Win — $1 to $50
      earned   = Math.floor(1 + Math.random() * 50);
      response = RESPONSES_WIN[Math.floor(Math.random() * RESPONSES_WIN.length)];
      color    = COLORS.SUCCESS;
      user.wallet += earned;
    } else if (roll < 0.85) {
      // Nothing
      response = RESPONSES_LOSE[Math.floor(Math.random() * RESPONSES_LOSE.length)];
      color    = 0x888888;
    } else {
      // Fine — lose $5–$20
      const fine   = Math.floor(5 + Math.random() * 15);
      earned       = -fine;
      response     = RESPONSES_FINE[Math.floor(Math.random() * RESPONSES_FINE.length)];
      color        = COLORS.ERROR;
      user.wallet  = Math.max(0, user.wallet - fine);
    }

    saveUser(interaction.user.id, user);

    const desc = earned > 0
      ? `${response.emoji} *${response.msg}*\n\nYou received **+$${earned}**!`
      : earned < 0
      ? `${response.emoji} *${response.msg}*\n\nYou lost **$${Math.abs(earned)}**!`
      : `${response.emoji} *${response.msg}*\n\nYou got nothing.`;

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle('🤲 Begging...')
      .setDescription(desc)
      .addFields({ name: '💵 Wallet', value: `$${user.wallet.toLocaleString()}`, inline: true })
    ]});
  },
};
