const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getEntitiesByOwner, deleteEntity, AI_ARCHETYPES } = require('../../utils/aiEntities');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myai')
    .setDescription('View all your AI entities.'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const entities = getEntitiesByOwner(interaction.user.id);

    if (!entities.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('🤖 No AI Entities').setDescription("You don't own any AI entities yet.\nBuy items with the **AI** effect type from the shop to spawn one.")], ephemeral: true });

    const lines = entities.map(e => {
      const arch  = AI_ARCHETYPES[e.archetype] || {};
      const mood  = e.mood === 'rogue' ? '😡 ROGUE' : e.mood === 'happy' ? '😊 Happy' : '😐 Idle';
      const bar   = '█'.repeat(Math.floor((e.loyalty||50)/10)) + '░'.repeat(10-Math.floor((e.loyalty||50)/10));
      return `${arch.emoji || '🤖'} **${e.name}** — ${arch.name}\n  Mood: ${mood} · Loyalty: \`[${bar}]\` ${e.loyalty||50}/100\n  Chats: ${e.interactions||0} · Created: ${new Date(e.createdAt).toLocaleDateString()}`;
    });

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🤖 Your AI Entities')
      .setDescription(lines.join('\n\n'))
      .setFooter({ text: 'Use /talk to interact · Entities can go rogue if mistreated!' })
    ], ephemeral: true });
  },
};
