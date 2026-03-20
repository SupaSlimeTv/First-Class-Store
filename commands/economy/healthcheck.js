const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getHealth, getStatus, MAX_HP } = require('../../utils/gunDb');
const { noAccount } = require('../../utils/accountCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Check your current health status.')
    .addUserOption(o => o.setName('user').setDescription('Check another player\'s health').setRequired(false)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const target = interaction.options.getUser('user') || interaction.user;
    const health = getHealth(target.id);
    const status = getStatus(health.hp);
    const hpBar  = '█'.repeat(Math.floor(health.hp/10)) + '░'.repeat(10-Math.floor(health.hp/10));
    const isSelf = target.id === interaction.user.id;

    const hospitalUntil = health.hospitalUntil && Date.now() < health.hospitalUntil;
    const minsLeft      = hospitalUntil ? Math.ceil((health.hospitalUntil - Date.now()) / 60000) : 0;

    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(status.color)
      .setTitle(`${status.label} — ${isSelf ? 'Your' : target.username + '\'s'} Health`)
      .setDescription(`\`[${hpBar}] ${health.hp}/${MAX_HP}\`\n*${status.desc}*`)
      .addFields(
        { name:'💀 Deaths',    value:(health.deathCount||0).toString(), inline:true },
        { name:'📅 Status',    value:hospitalUntil ? `🏥 Down for ${minsLeft}m` : status.label, inline:true },
      )
      .setFooter({ text:'Use /medkit to heal · /shoot @user to attack' })
    ], ephemeral: isSelf });
  },
};
