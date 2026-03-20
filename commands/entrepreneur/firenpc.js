const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getBusiness, saveBusiness } = require('../../utils/bizDb');
const { getNPC } = require('../../utils/npcEmployees');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('firenpc')
    .setDescription('Fire an NPC employee from your business.'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const userId = interaction.user.id;
    const biz    = getBusiness(userId);
    if (!biz) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a business.")], ephemeral: true });

    const npcEmps = (biz.employees || []).filter(e => e.isNPC);
    if (!npcEmps.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have any NPC employees to fire.")], ephemeral: true });

    const options = npcEmps.map(emp => {
      const npc = getNPC(emp.npcId);
      return { label: `${npc?.name || emp.npcId} — ${emp.role}`, value: emp.npcId, emoji: npc?.emoji || '👤' };
    });

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('firenpc_select').setPlaceholder('Choose who to fire...').addOptions(options)
    );

    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff3b3b).setTitle('🔴 Fire NPC Employee').setDescription('Select an NPC to let go. No severance pay.')], components: [row], ephemeral: true });

    const msg       = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 30_000 });
    collector.on('collect', async i => {
      if (i.user.id !== userId) return;
      const npcId    = i.values[0];
      const npc      = getNPC(npcId);
      const freshBiz = getBusiness(userId);
      freshBiz.employees = (freshBiz.employees || []).filter(e => !(e.isNPC && e.npcId === npcId));
      await saveBusiness(userId, freshBiz);
      collector.stop();
      await i.update({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('📋 NPC Fired').setDescription(`**${npc?.name || npcId}** has been let go from **${freshBiz.name}**.`)], components: [] });
    });
  },
};
