const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllGangs } = require('../../utils/gangDb');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gangs')
    .setDescription('See all gangs ranked by rep.'),

  async execute(interaction) {
    const all  = getAllGangs();
    const list = Object.values(all).sort((a,b) => (b.rep||0)-(a.rep||0));

    if (!list.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('No Gangs Yet').setDescription('No gangs have been formed. Start one with `/gang create`.')] });

    const lines = list.slice(0,15).map((g,i) => {
      const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`**${i+1}.**`;
      return `${medal} ${g.color} **${g.name}** ${g.tag} — ${g.rep} rep · ${g.members.length} members · ${g.wins}W/${g.losses}L`;
    });

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0xff3b3b)
      .setTitle('🏴 Gang Rankings')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${list.length} total gangs` })
    ]});
  },
};
