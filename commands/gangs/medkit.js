const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getHealth, saveHealth, getStatus, MAX_HP } = require('../../utils/gunDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('medkit')
    .setDescription('Use a medkit to restore HP.')
    .addIntegerOption(o => o.setName('amount').setDescription('$ to spend on healing ($10 = 5 HP)').setRequired(true).setMinValue(10)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const amount = interaction.options.getInteger('amount');
    const userId = interaction.user.id;
    const health = getHealth(userId);

    if (health.hospitalUntil && Date.now() < health.hospitalUntil) {
      const mins = Math.ceil((health.hospitalUntil - Date.now()) / 60000);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x003580).setTitle('🏥 Still Down').setDescription(`You're out of commission for **${mins} more minutes**.\n\nA medkit can't fix this — you need a hospital (coming soon).`)], ephemeral:true });
    }

    if (health.hp >= MAX_HP) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('You\'re already at full health.')], ephemeral:true });

    const user = getOrCreateUser(userId);
    if (user.wallet < amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You only have **$${user.wallet.toLocaleString()}**.`)], ephemeral:true });

    const healAmt  = Math.floor(amount / 2); // $1 = 0.5 HP
    user.wallet   -= amount;
    health.hp      = Math.min(MAX_HP, (health.hp||0) + healAmt);
    health.status  = health.hp <= 20 ? 'critical' : health.hp <= 50 ? 'injured' : 'alive';
    health.lastUpdated = Date.now();

    saveUser(userId, user);
    saveHealth(userId, health);

    const status = getStatus(health.hp);
    const hpBar  = '█'.repeat(Math.floor(health.hp/10)) + '░'.repeat(10-Math.floor(health.hp/10));

    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(status.color)
      .setTitle('💊 Medkit Used')
      .setDescription(`Spent **$${amount.toLocaleString()}** on medical supplies.`)
      .addFields(
        { name:'❤️ HP', value:`[${hpBar}] ${health.hp}/${MAX_HP}`, inline:true },
        { name:'Status', value:status.label, inline:true },
        { name:'💵 Wallet', value:`$${user.wallet.toLocaleString()}`, inline:true },
      )
      .setFooter({ text:'$2 = +1 HP · Hospitals coming soon for critical injuries' })
    ]});
  },
};
