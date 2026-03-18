const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const REELS = ['🍒','🍋','🍊','🔔','⭐','💎','7️⃣','🎰'];

const PAYOUTS = [
  { match: '7️⃣', mult: 10,  label: 'JACKPOT' },
  { match: '💎', mult: 7,   label: 'DIAMONDS' },
  { match: '⭐', mult: 5,   label: 'STARS' },
  { match: '🔔', mult: 4,   label: 'BELLS' },
  { match: '🍊', mult: 3,   label: 'ORANGES' },
  { match: '🍋', mult: 2.5, label: 'LEMONS' },
  { match: '🍒', mult: 2,   label: 'CHERRIES' },
  { match: null,  mult: 1.5, label: 'ANY MATCH' }, // any 3 matching
];

function spin() {
  return [
    REELS[Math.floor(Math.random() * REELS.length)],
    REELS[Math.floor(Math.random() * REELS.length)],
    REELS[Math.floor(Math.random() * REELS.length)],
  ];
}

function getPayout(reels, bet) {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    const rule = PAYOUTS.find(p => p.match === a) || PAYOUTS.find(p => p.match === null);
    return { won: true, amount: Math.floor(bet * rule.mult), label: rule.label };
  }
  // Two of a kind = get half back
  if (a === b || b === c || a === c) {
    return { won: false, amount: Math.floor(bet * 0.5), label: 'CLOSE...' };
  }
  return { won: false, amount: 0, label: 'MISS' };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Spin the slot machine!')
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet from your wallet').setRequired(true).setMinValue(10)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const bet  = interaction.options.getInteger('bet');
    const user = getOrCreateUser(interaction.user.id);

    if (bet > user.wallet) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ Not Enough').setDescription(`You only have **$${user.wallet.toLocaleString()}** in your wallet.`)], ephemeral: true });

    user.wallet -= bet;
    const reels   = spin();
    const result  = getPayout(reels, bet);
    user.wallet  += result.amount;
    saveUser(interaction.user.id, user);

    const display = `╔═══════════════╗\n║  ${reels.join('  ')}  ║\n╚═══════════════╝`;
    const net     = result.amount - bet;
    const color   = result.won ? (result.label === 'JACKPOT' ? 0xf5c518 : COLORS.SUCCESS) : net >= 0 ? 0x888888 : COLORS.ERROR;

    let title = result.won ? `🎰 ${result.label}!` : result.label === 'CLOSE...' ? '🎰 So Close...' : '🎰 No Match';

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(`\`\`\`${display}\`\`\``)
      .addFields(
        { name: '🎲 Result',    value: result.label,                                  inline: true },
        { name: '💰 Payout',   value: `$${result.amount.toLocaleString()}`,           inline: true },
        { name: net >= 0 ? '📈 Net' : '📉 Net', value: `${net >= 0 ? '+' : ''}$${net.toLocaleString()}`, inline: true },
        { name: '💵 Wallet',   value: `$${user.wallet.toLocaleString()}`,             inline: true },
      )
      .setFooter({ text: 'Three matching = win · Two matching = half back' })
    ]});
  },
};
