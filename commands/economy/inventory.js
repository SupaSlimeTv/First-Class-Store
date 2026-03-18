const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getStore } = require('../../utils/db');
const { errorEmbed, COLORS } = require('../../utils/embeds');
const { noAccount } = require('../../utils/accountCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View your inventory or another player\'s.')
    .addUserOption(o => o.setName('user').setDescription('Check another player\'s inventory').setRequired(false)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;

    const target    = interaction.options.getUser('user') || interaction.user;
    const isSelf    = target.id === interaction.user.id;
    const userData  = getUser(target.id);

    if (!userData) {
      return interaction.reply({
        embeds: [errorEmbed(`**${target.username}** doesn't have an account yet.`)],
        ephemeral: true,
      });
    }

    const store  = getStore();
    const inv    = userData.inventory || [];

    if (!inv.length) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(COLORS.SHOP || 0x5865f2)
          .setTitle(`🎒 ${isSelf ? 'Your' : target.username + "'s"} Inventory`)
          .setDescription(isSelf ? 'Your inventory is empty.\nVisit `/shop browse` to see available items.' : `**${target.username}** has nothing in their inventory.`)
        ],
        ephemeral: isSelf,
      });
    }

    // Count duplicates
    const counts = inv.reduce((a, id) => { a[id] = (a[id]||0)+1; return a; }, {});

    const lines = Object.entries(counts).map(([id, cnt]) => {
      const item = store.items.find(i => i.id === id);
      const name = item ? item.name : id;
      const tag  = item?.reusable ? '♻️' : '🗑️';
      const use  = isSelf && item ? ` — \`/use ${id}\`` : '';
      const desc = item?.description ? `\n  ↳ *${item.description}*` : '';
      return `${tag} **${name}**${cnt > 1 ? ` ×${cnt}` : ''}${use}${desc}`;
    });

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.SHOP || 0x5865f2)
        .setTitle(`🎒 ${isSelf ? 'Your' : target.username + "'s"} Inventory`)
        .setDescription(lines.join('\n\n'))
        .setThumbnail(target.displayAvatarURL())
        .setFooter({ text: `${inv.length} item${inv.length !== 1 ? 's' : ''} total` })
      ],
    });
  },
};
