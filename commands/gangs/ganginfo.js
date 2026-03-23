const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGangByMember, getAllGangs, getMemberRank } = require('../../utils/gangDb');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ganginfo')
    .setDescription('Detailed info about your gang or another.')
    .addStringOption(o => o.setName('name').setDescription('Gang name to look up').setRequired(false)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const search = interaction.options.getString('name');
    let gang;
    if (search) {
      gang = Object.values(getAllGangs()).find(g => g.name.toLowerCase().includes(search.toLowerCase()));
      if (!gang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`No gang named **${search}** found.`)], ephemeral: true });
    } else {
      gang = getGangByMember(userId);
      if (!gang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You're not in a gang. Use `/gang create` to start one.")], ephemeral: true });
    }

    const isMafia    = gang.gangType === 'mafia';
    const typeLabel  = isMafia ? '👔 Mafia' : '🔫 Street Gang';
    const memberList = gang.members.slice(0,10).map(m => {
      const rank = getMemberRank(m.rep||0);
      return `${gang.color} <@${m.userId}> — ${m.role==='Leader'?'👑 Boss':rank.name} (${m.rep||0} rep)`;
    }).join('\n');

    const upgrades = [];
    if (gang.police_payroll) upgrades.push(`👮 Police on Payroll Lv${gang.police_payroll}`);
    if (gang.armory)         upgrades.push(`🔫 Armory Lv${gang.armory}`);
    if (gang.safehouses)     upgrades.push(`🏠 Safehouses Lv${gang.safehouses}`);

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(isMafia ? 0x2c3e50 : 0xff3b3b)
      .setTitle(`${gang.color} ${gang.name} ${gang.tag}`)
      .setDescription(`${typeLabel}${isMafia ? '\n*"The family doesn\'t forget."*' : ''}`)
      .addFields(
        { name:'👑 Leader',      value:`<@${gang.leaderId}>`,             inline:true },
        { name:'👥 Members',     value:`${gang.members.length}/20`,       inline:true },
        { name:'🏆 Rep',         value:(gang.rep||0).toString(),          inline:true },
        { name:'💀 Record',      value:`${gang.wins||0}W / ${gang.losses||0}L`, inline:true },
        { name:'💰 Bank',        value:`$${(gang.bank||0).toLocaleString()}`, inline:true },
        { name:'⭐ Level',       value:(gang.level||1).toString(),        inline:true },
        { name:'🛠️ Upgrades',   value:upgrades.length?upgrades.join('\n'):'None', inline:false },
        { name:`🧑‍🤝‍🧑 Roster (${gang.members.length})`, value:memberList||'Empty', inline:false },
      )
      .setFooter({ text:`Founded ${new Date(gang.createdAt).toLocaleDateString()}` })
    ]});
  },
};
