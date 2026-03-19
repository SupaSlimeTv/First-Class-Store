const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllPets, PET_TYPES, calcPetStats } = require('../../utils/petDb');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pets')
    .setDescription('See all pets in the server ranked by power.'),

  async execute(interaction) {
    const all  = getAllPets();
    const list = Object.values(all)
      .map(p => ({ ...p, stats: calcPetStats(p), typeName: PET_TYPES[p.type]?.name || p.type }))
      .sort((a, b) => (b.stats.power - a.stats.power) || (b.level - a.level));

    if (!list.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('🐾 No Pets Yet').setDescription('Nobody has a pet yet! Visit `/petshop` to adopt one.')] });

    const lines = list.slice(0, 15).map((p, i) => {
      const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`**${i+1}.**`;
      return `${medal} ${p.emoji} **${p.name}** (${p.typeName}) — Lv${p.level} · ⚔️${p.stats.power} · <@${p.ownerId}>`;
    });

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0xff6b35)
      .setTitle('🐾 Pet Rankings')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${list.length} total pets` })
    ]});
  },
};
