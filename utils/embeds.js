// ============================================================
// utils/embeds.js — UnbelievaBoat-inspired embed system
// ============================================================

const { EmbedBuilder } = require('discord.js');

const COLORS = {
  SUCCESS:  0x2ECC71,
  ERROR:    0xE74C3C,
  INFO:     0x3498DB,
  GOLD:     0xF1C40F,
  ECONOMY:  0x2C2F33,
  PURGE:    0xFF0000,
  GAME:     0x7289DA,
  WARNING:  0xE67E22,
  SHOP:     0x1ABC9C,
  DAILY:    0xF39C12,
  DEPOSIT:  0x27AE60,
  WITHDRAW: 0xE67E22,
};

function balanceEmbed(user, discordUser) {
  const wallet = user.wallet || 0;
  const bank   = user.bank   || 0;
  const total  = wallet + bank;
  return new EmbedBuilder()
    .setColor(COLORS.ECONOMY)
    .setAuthor({ name: `${discordUser.username}'s Balance`, iconURL: discordUser.displayAvatarURL({ dynamic: true }) })
    .addFields(
      { name: '💵 Cash',  value: `**$${wallet.toLocaleString()}**`, inline: true },
      { name: '🏦 Bank',  value: `**$${bank.toLocaleString()}**`,   inline: true },
      { name: '💎 Total', value: `**$${total.toLocaleString()}**`,  inline: true },
    )
    .setFooter({ text: 'Use /deposit to keep your cash safe' })
    .setTimestamp();
}

function depositEmbed(user, amount) {
  return new EmbedBuilder()
    .setColor(COLORS.DEPOSIT)
    .setTitle('🏦 Deposit Successful')
    .addFields(
      { name: 'Deposited',   value: `**$${amount.toLocaleString()}**`,      inline: true },
      { name: '💵 Cash Now', value: `**$${user.wallet.toLocaleString()}**`, inline: true },
      { name: '🏦 Bank Now', value: `**$${user.bank.toLocaleString()}**`,   inline: true },
    )
    .setTimestamp();
}

function withdrawEmbed(user, amount) {
  return new EmbedBuilder()
    .setColor(COLORS.WITHDRAW)
    .setTitle('💵 Withdrawal Successful')
    .addFields(
      { name: 'Withdrawn',   value: `**$${amount.toLocaleString()}**`,      inline: true },
      { name: '💵 Cash Now', value: `**$${user.wallet.toLocaleString()}**`, inline: true },
      { name: '🏦 Bank Now', value: `**$${user.bank.toLocaleString()}**`,   inline: true },
    )
    .setTimestamp();
}

function dailyEmbed(amount, newBalance) {
  return new EmbedBuilder()
    .setColor(COLORS.DAILY)
    .setTitle('📅 Daily Reward Claimed!')
    .addFields(
      { name: '💰 Received',  value: `**$${amount.toLocaleString()}**`,    inline: true },
      { name: '💵 Cash Now',  value: `**$${newBalance.toLocaleString()}**`, inline: true },
    )
    .setFooter({ text: 'Come back in 24 hours for your next reward' })
    .setTimestamp();
}

function robSuccessEmbed(stolen, targetUsername, newBalance, purge) {
  return new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('🦹 Robbery Successful!')
    .setDescription(`You successfully robbed **${targetUsername}**!`)
    .addFields(
      { name: '💸 Stolen',    value: `**$${stolen.toLocaleString()}**`,     inline: true },
      { name: '💵 Your Cash', value: `**$${newBalance.toLocaleString()}**`, inline: true },
      ...(purge ? [{ name: '⚡ Purge', value: 'No cooldown!', inline: true }] : []),
    )
    .setTimestamp();
}

function robFailEmbed(fine, newBalance) {
  return new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setTitle('🚨 Robbery Failed!')
    .setDescription('You got caught trying to rob someone!')
    .addFields(
      { name: '💸 Fine',      value: `**$${fine.toLocaleString()}**`,       inline: true },
      { name: '💵 Your Cash', value: `**$${newBalance.toLocaleString()}**`, inline: true },
    )
    .setTimestamp();
}

function shopEmbed(items) {
  const typeEmoji = { useable: '⚡', cosmetic: '🎨', role: '🏅' };
  const embed = new EmbedBuilder()
    .setColor(COLORS.SHOP)
    .setTitle('🛒 Item Store')
    .setDescription('Use `/shop buy <id>` to purchase an item.\n\u200b')
    .setTimestamp();
  for (const item of items) {
    embed.addFields({
      name: `${typeEmoji[item.type] || '📦'} ${item.name} — $${item.price.toLocaleString()}`,
      value: `${item.description || 'No description.'}\n${item.reusable ? '`♻️ Reusable`' : '`🗑️ Single-use`'}  \`ID: ${item.id}\``,
      inline: false,
    });
  }
  return embed;
}

function purchaseEmbed(item, newBalance) {
  return new EmbedBuilder()
    .setColor(COLORS.SHOP)
    .setTitle(`✅ Purchased: ${item.name}`)
    .setDescription(item.description || '')
    .addFields(
      { name: '💸 Cost',     value: `**$${item.price.toLocaleString()}**`,          inline: true },
      { name: '💵 Cash Now', value: `**$${newBalance.toLocaleString()}**`,          inline: true },
      { name: '📦 Type',     value: item.reusable ? '♻️ Reusable' : '🗑️ One-time', inline: true },
    )
    .setFooter({ text: item.type === 'useable' ? `Use it with /use ${item.id}` : 'Check /shop inventory' })
    .setTimestamp();
}

function coinflipEmbed(choice, result, bet, won, newBalance) {
  return new EmbedBuilder()
    .setColor(won ? COLORS.SUCCESS : COLORS.ERROR)
    .setTitle(`${result === 'heads' ? '🪙' : '🥈'} Coin Flip — ${won ? 'You Won!' : 'You Lost!'}`)
    .addFields(
      { name: 'Your Pick',   value: `**${choice}**`,                              inline: true },
      { name: 'Result',      value: `**${result}**`,                              inline: true },
      { name: won ? '💰 Won' : '💸 Lost', value: `**$${bet.toLocaleString()}**`, inline: true },
      { name: '💵 Cash Now', value: `**$${newBalance.toLocaleString()}**`,        inline: false },
    )
    .setTimestamp();
}

function rouletteEmbed(betType, betDesc, result, resultColor, bet, won, payout, newBalance) {
  const colorEmoji = { red: '🔴', black: '⚫', green: '🟢' }[resultColor] || '⚪';
  return new EmbedBuilder()
    .setColor(won ? COLORS.SUCCESS : COLORS.ERROR)
    .setTitle(`🎡 Roulette — ${won ? 'You Won!' : 'You Lost!'}`)
    .setDescription(`The wheel landed on ${colorEmoji} **${result}**`)
    .addFields(
      { name: 'Bet Type',    value: `**${betType}**`,                             inline: true },
      { name: 'Payout',      value: `**${payout}:1**`,                            inline: true },
      { name: won ? '💰 Won' : '💸 Lost', value: `**$${bet.toLocaleString()}**`, inline: true },
      { name: '💵 Cash Now', value: `**$${newBalance.toLocaleString()}**`,        inline: false },
    )
    .setTimestamp();
}

function depressionEmbed(starting, gifUrl) {
  if (starting) {
    const embed = new EmbedBuilder()
      .setColor(0x2c2c2c)
      .setTitle('📉 THE GREAT DEPRESSION HAS BEGUN')
      .setDescription('**The economy has collapsed.**\n\n> 💸 All wallets wiped to $0\n> 🏦 All banks wiped to $0\n> 📈 All stock holdings liquidated\n> 💊 Dirty money seized\n> 💼 Business revenue drained\n\n**Everyone starts from zero. Rebuild or perish.**\n\n*The server owner triggered a full economic reset.*')
      .setTimestamp();
    if (gifUrl) embed.setImage(gifUrl);
    else embed.setImage('https://media.giphy.com/media/l2JehQ2GitHGdVG9a/giphy.gif');
    return embed;
  }
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('📈 THE ECONOMY HAS RECOVERED')
    .setDescription('**The Great Depression has ended.**\n\n> 💵 Economic activity can resume\n> 🏦 Deposits and withdrawals restored\n> 📈 Markets are open again\n\nTime to rebuild.')
    .setTimestamp();
}

function purgeEmbed(starting, gifUrl) {
  if (starting) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.PURGE)
      .setTitle('🔴 THE PURGE IS NOW ACTIVE @everyone')
      .setDescription('**@everyone — The Purge has begun. All bank funds have been forcefully moved to wallets.**\n\n> 💸 All money is now exposed and vulnerable\n> 🚫 Deposits and withdrawals are **DISABLED**\n> ⚡ Rob cooldowns are **COMPLETELY REMOVED**\n> 🔫 All attacks, drains, and hitmen still work\n> 🏴 Gang wars have zero consequences\n\n**Protect yourself. Trust nobody.**\n\n*The purge will continue until the server owner ends it.*')
      .setTimestamp();
    const gif = gifUrl || 'https://media.giphy.com/media/l0HlKrB02QY0f1mbm/giphy.gif';
    embed.setImage(gif);
    return embed;
  }
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('🟢 THE PURGE HAS ENDED @everyone')
    .setDescription('**@everyone — The Purge is over. Normal operations have resumed.**\n\n> 🏦 Deposits and withdrawals are back\n> ⏱️ Rob cooldowns are restored\n> 🛡️ Standard protections apply\n\nDeposit your money to keep it safe.')
    .setTimestamp();
  if (gifUrl) embed.setImage(gifUrl);
  return embed;
}

function successEmbed(title, description) {
  return new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle(`✅ ${title}`).setDescription(description).setTimestamp();
}

function errorEmbed(description) {
  return new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ Error').setDescription(description);
}

function gameEmbed(title, description, won) {
  return new EmbedBuilder().setColor(won ? COLORS.SUCCESS : COLORS.ERROR).setTitle(title).setDescription(description).setTimestamp();
}

module.exports = {
  COLORS, balanceEmbed, depositEmbed, withdrawEmbed, dailyEmbed,
  robSuccessEmbed, robFailEmbed, shopEmbed, purchaseEmbed,
  coinflipEmbed, rouletteEmbed, purgeEmbed, depressionEmbed, successEmbed, errorEmbed, gameEmbed,
};
