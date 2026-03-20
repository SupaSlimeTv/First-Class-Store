const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGunInventory, getGunById, getHealth, getStatus } = require('../../utils/gunDb');
const { noAccount } = require('../../utils/accountCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('guns')
    .setDescription('View your gun inventory and health status.'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const inv    = getGunInventory(interaction.user.id);
    const health = getHealth(interaction.user.id);
    const status = getStatus(health.hp);

    const invLines = inv.length
      ? inv.map(i => {
          const g = getGunById(i.gunId);
          return g ? `${g.emoji} **${g.name}** — 📦 ${i.ammo} rounds · ${g.type}` : `❓ Unknown (${i.gunId})`;
        }).join('\n')
      : '*Empty — visit /gunshop to buy weapons*';

    const hpBar = '█'.repeat(Math.floor(health.hp/10)) + '░'.repeat(10-Math.floor(health.hp/10));

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(status.color)
      .setTitle('🔫 Your Arsenal')
      .addFields(
        { name:`${status.label} [${hpBar}] ${health.hp}/100`, value: status.desc, inline: false },
        { name:'🔫 Weapons', value: invLines, inline: false },
        { name:'💀 Deaths',  value: (health.deathCount||0).toString(), inline: true },
      )
      .setFooter({ text: 'Use /shoot @user to attack · /gunshop to buy more · /medkit to heal' })
    ], ephemeral: true });
  },
};
