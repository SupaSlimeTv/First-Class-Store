const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPoliceRecord } = require('../../utils/gangDb');
const { getHeatLevel, HEAT_LEVELS } = require('../../utils/police');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wantedlevel')
    .setDescription('Check your current wanted level and police record.'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const record = getPoliceRecord(userId);
    const heat   = record.heat || 0;
    const level  = getHeatLevel(heat);
    const jailed = record.jailUntil && Date.now() < record.jailUntil;
    const jailLeft = jailed ? Math.ceil((record.jailUntil - Date.now()) / 60000) : 0;

    const bar = '█'.repeat(Math.floor(heat/10)) + '░'.repeat(10 - Math.floor(heat/10));

    const stars = heat > 75 ? '⭐⭐⭐⭐⭐' : heat > 50 ? '⭐⭐⭐⭐' : heat > 25 ? '⭐⭐⭐' : heat > 10 ? '⭐⭐' : heat > 0 ? '⭐' : '☆☆☆☆☆';

    const recentOffenses = (record.offenses || []).slice(-5).reverse().map(o =>
      `• ${o.type.replace(/_/g,' ')} (+${o.heat} heat)`
    ).join('\n') || 'Clean record';

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(heat > 75 ? 0xff0000 : heat > 50 ? 0xff8800 : heat > 25 ? 0xffff00 : 0x00ff00)
      .setTitle(`🚔 Wanted Level — ${level.name}`)
      .setDescription(`${stars}\n\`[${bar}] ${heat}/100\``)
      .addFields(
        { name: '🌡️ Heat',        value: `${heat}/100`,                                 inline: true },
        { name: '🚔 Arrests',     value: (record.arrests || 0).toString(),               inline: true },
        { name: '⏰ Status',       value: jailed ? `🔒 Jailed — ${jailLeft}m left` : '🟢 Free', inline: true },
        { name: '📋 Recent Activity', value: recentOffenses,                              inline: false },
      )
      .setFooter({ text: 'Heat decays 1 point per minute. Stay low.' })
    ], ephemeral: true });
  },
};
