const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getConfig } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

const JOBS = [
  { title: 'Uber Driver',        flavor: 'You drove 12 passengers and only 2 were weird.' },
  { title: 'Food Delivery',      flavor: 'The food arrived cold but the tip was warm.' },
  { title: 'Freelance Designer', flavor: 'Client wanted it in Comic Sans. You refused.' },
  { title: 'Stock Boy',          flavor: 'You stacked cans for 4 hours. Very satisfying.' },
  { title: 'Dog Walker',         flavor: 'Walked 6 dogs. One tried to walk you.' },
  { title: 'Street Performer',   flavor: 'The crowd was small but they were enthusiastic.' },
  { title: 'Pizza Maker',        flavor: 'You ate 2 slices before the shift ended.' },
  { title: 'Tutor',              flavor: 'The kid learned nothing. You got paid anyway.' },
  { title: 'Social Media Manager', flavor: 'Posted 3 memes. One went viral.' },
  { title: 'Warehouse Worker',   flavor: 'Heavy boxes all day. Your back hurts but wallet doesn\'t.' },
  { title: 'Barista',            flavor: 'You spelled every name wrong on purpose.' },
  { title: 'Security Guard',     flavor: 'Nothing happened. Perfect shift.' },
  { title: 'Data Entry',         flavor: 'You typed 10,000 words. None of them mattered.' },
  { title: 'Cashier',            flavor: 'Every customer had exact change except one.' },
  { title: 'Handyman',           flavor: 'Fixed the sink. Broke the cabinet. Net positive.' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work a job and earn money. Cooldown: 1 hour.'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const user = getOrCreateUser(interaction.user.id);
    const now  = Date.now();

    if (user.lastWork && now - user.lastWork < COOLDOWN_MS) {
      const left = COOLDOWN_MS - (now - user.lastWork);
      const m = Math.ceil(left / 60000);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('⏰ Still Working').setDescription(`You're still tired from your last shift.\nCome back in **${m} minute(s)**.`)], ephemeral: true });
    }

    const job    = JOBS[Math.floor(Math.random() * JOBS.length)];
    const earned = Math.floor(50 + Math.random() * 200);
    user.wallet  += earned;
    user.lastWork = now;
    saveUser(interaction.user.id, user);

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`💼 ${job.title}`)
      .setDescription(`*${job.flavor}*\n\nYou earned **$${earned.toLocaleString()}**!`)
      .addFields({ name: '💵 Wallet', value: `$${user.wallet.toLocaleString()}`, inline: true })
      .setFooter({ text: 'Cooldown: 1 hour' })
    ]});
  },
};
