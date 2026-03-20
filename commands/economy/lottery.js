const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getConfig } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const fs   = require('fs');
const path = require('path');

const LOTTERY_FILE = path.join(__dirname, '../../data/lottery.json');

function getLottery() {
  try {
    if (!fs.existsSync(LOTTERY_FILE)) return initLottery();
    return JSON.parse(fs.readFileSync(LOTTERY_FILE, 'utf8'));
  } catch { return initLottery(); }
}

function initLottery() {
  const config = getConfig(interaction.guildId);
  const lottery = {
    active:     config.lottery?.active ?? true,
    ticketPrice: config.lottery?.ticketPrice ?? 100,
    pot:        0,
    tickets:    [], // [{ userId, count }]
    drawAt:     Date.now() + (config.lottery?.intervalHours ?? 24) * 3600000,
    lastWinner: null,
    lastPot:    0,
  };
  fs.writeFileSync(LOTTERY_FILE, JSON.stringify(lottery, null, 2));
  return lottery;
}

function saveLottery(data) {
  fs.writeFileSync(LOTTERY_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lottery')
    .setDescription('Buy lottery tickets or check the current pot.')
    .addSubcommand(s => s.setName('buy').setDescription('Buy lottery tickets').addIntegerOption(o => o.setName('tickets').setDescription('Number of tickets to buy').setRequired(true).setMinValue(1).setMaxValue(50)))
    .addSubcommand(s => s.setName('info').setDescription('Check the current lottery pot and time remaining')),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub     = interaction.options.getSubcommand();
    const lottery = getLottery();

    if (!lottery.active) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('🎟️ Lottery Closed').setDescription('The lottery is currently closed. Check back later.')], ephemeral: true });

    if (sub === 'info') {
      const timeLeft = Math.max(0, lottery.drawAt - Date.now());
      const h = Math.floor(timeLeft / 3600000);
      const m = Math.floor((timeLeft % 3600000) / 60000);
      const totalTickets = lottery.tickets.reduce((s, t) => s + t.count, 0);
      const userEntry    = lottery.tickets.find(t => t.userId === interaction.user.id);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🎟️ Lottery')
        .addFields(
          { name: '💰 Current Pot',    value: `$${lottery.pot.toLocaleString()}`,          inline: true },
          { name: '🎫 Total Tickets',  value: totalTickets.toString(),                      inline: true },
          { name: '⏰ Draw In',         value: timeLeft > 0 ? `${h}h ${m}m` : 'Drawing soon!', inline: true },
          { name: '🎟️ Ticket Price',  value: `$${lottery.ticketPrice.toLocaleString()}`,   inline: true },
          { name: '🎯 Your Tickets',   value: userEntry ? userEntry.count.toString() : '0', inline: true },
          { name: '📊 Your Odds',      value: userEntry && totalTickets > 0 ? `${((userEntry.count / totalTickets) * 100).toFixed(1)}%` : '0%', inline: true },
        )
        .setFooter({ text: lottery.lastWinner ? `Last winner: User ${lottery.lastWinner} won $${lottery.lastPot?.toLocaleString() || '?'}` : 'No previous winner' })
      ]});
    }

    if (sub === 'buy') {
      const count = interaction.options.getInteger('tickets');
      const cost  = count * lottery.ticketPrice;
      const user  = getOrCreateUser(interaction.user.id);

      if (cost > user.wallet) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You need **$${cost.toLocaleString()}** but only have **$${user.wallet.toLocaleString()}** in your wallet.`)], ephemeral: true });

      user.wallet -= cost;
      lottery.pot += cost;

      const existing = lottery.tickets.find(t => t.userId === interaction.user.id);
      if (existing) existing.count += count;
      else lottery.tickets.push({ userId: interaction.user.id, count });

      saveUser(interaction.user.id, user);
      saveLottery(lottery);

      const totalTickets = lottery.tickets.reduce((s, t) => s + t.count, 0);
      const myTotal      = lottery.tickets.find(t => t.userId === interaction.user.id)?.count || count;

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🎟️ Tickets Purchased!')
        .setDescription(`You bought **${count} ticket${count > 1 ? 's' : ''}** for **$${cost.toLocaleString()}**!`)
        .addFields(
          { name: '💰 Pot',          value: `$${lottery.pot.toLocaleString()}`,                              inline: true },
          { name: '🎯 Your Tickets', value: `${myTotal} / ${totalTickets}`,                                  inline: true },
          { name: '📊 Win Chance',   value: `${((myTotal / totalTickets) * 100).toFixed(1)}%`,               inline: true },
          { name: '💵 Wallet',       value: `$${user.wallet.toLocaleString()}`,                              inline: true },
        )
      ]});
    }
  },

  // Export these for the lottery tick engine
  getLottery,
  saveLottery,
};
