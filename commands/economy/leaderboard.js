const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getAllUsers } = require('../../utils/db');
const { COLORS } = require('../../utils/embeds');

const PAGE_SIZE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the top players by total balance.'),

  async execute(interaction) {
    const users = getAllUsers();

    // Build sorted list of users with accounts
    const sorted = Object.entries(users)
      .filter(([, u]) => u.wallet !== undefined)
      .map(([id, u]) => ({ id, total: (u.wallet||0) + (u.bank||0), wallet: u.wallet||0, bank: u.bank||0 }))
      .sort((a, b) => b.total - a.total);

    if (!sorted.length) return interaction.reply({ content: 'No players yet!', ephemeral: true });

    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

    async function buildEmbed(page) {
      const start = page * PAGE_SIZE;
      const slice = sorted.slice(start, start + PAGE_SIZE);

      const lines = await Promise.all(slice.map(async (u, i) => {
        const rank   = start + i + 1;
        const medal  = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**#${rank}**`;
        let name;
        try {
          const member = await interaction.guild.members.fetch(u.id).catch(() => null);
          name = member?.displayName || member?.user?.username || `<@${u.id}>`;
        } catch { name = `<@${u.id}>`; }
        return `${medal} **${name}** — $${u.total.toLocaleString()} *(💵 $${u.wallet.toLocaleString()} | 🏦 $${u.bank.toLocaleString()})*`;
      }));

      return new EmbedBuilder()
        .setColor(COLORS.GOLD || 0xf5c518)
        .setTitle('🏆 Leaderboard — Top Players')
        .setDescription(lines.join('\n'))
        .setFooter({ text: `Page ${page + 1} of ${totalPages} · ${sorted.length} total players` })
        .setTimestamp();
    }

    function buildRow(page) {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lb_prev_${page}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`lb_next_${page}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
      );
    }

    let page = 0;
    await interaction.reply({ embeds: [await buildEmbed(page)], components: [buildRow(page)] });

    const msg       = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 120_000 });

    collector.on('collect', async btn => {
      if (btn.user.id !== interaction.user.id) return btn.reply({ content: "This isn't your leaderboard.", ephemeral: true });
      if (btn.customId.startsWith('lb_prev')) page = Math.max(0, page - 1);
      if (btn.customId.startsWith('lb_next')) page = Math.min(totalPages - 1, page + 1);
      await btn.update({ embeds: [await buildEmbed(page)], components: [buildRow(page)] });
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
