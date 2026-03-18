const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getOrCreateUser, saveUser, getStore, giveItem, isBotBanned } = require('../../utils/db');
const { shopEmbed, purchaseEmbed, errorEmbed, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse or buy from the item store.')
    .addSubcommand((s) => s.setName('browse').setDescription('See all items in the store.'))
    .addSubcommand((s) => s.setName('buy').setDescription('Buy an item.').addStringOption((o) => o.setName('item_id').setDescription('Item ID').setRequired(true)))
    .addSubcommand((s) => s.setName('inventory').setDescription('View your owned items.')),

  async execute(interaction) {
    if (isBotBanned(interaction.user.id)) {
      const u = require('../../utils/db').getUser(interaction.user.id);
      const m = Math.ceil((u.bannedUntil - Date.now()) / 60000);
      return interaction.reply({ embeds: [errorEmbed(`🔫 You're locked out for **${m} more minute(s)**.`)], ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'browse') {
      const store   = getStore();
      const enabled = store.items.filter((i) => i.enabled);
      if (!enabled.length) return interaction.reply({ embeds: [errorEmbed('The store is empty right now.')], ephemeral: true });
      return interaction.reply({ embeds: [shopEmbed(enabled)] });
    }

    if (sub === 'buy') {
      const itemId = interaction.options.getString('item_id').toLowerCase();
      const store  = getStore();
      const item   = store.items.find((i) => i.id === itemId && i.enabled);
      if (!item) return interaction.reply({ embeds: [errorEmbed(`No item found with ID \`${itemId}\`.`)], ephemeral: true });

      const user = getUser(interaction.user.id);
      if (user.wallet < item.price) return interaction.reply({ embeds: [errorEmbed(`You need **$${item.price.toLocaleString()}** but only have **$${user.wallet.toLocaleString()}**.`)], ephemeral: true });

      // ---- REQUIREMENTS CHECK ----
      if (item.requirements) {
        const req = item.requirements;
        if (req.type === 'balance') {
          const total = user.wallet + user.bank;
          if (total < req.value) {
            return interaction.reply({ embeds: [errorEmbed(`You need a total balance of **$${Number(req.value).toLocaleString()}** to buy this.\nYours: **$${total.toLocaleString()}**`)], ephemeral: true });
          }
        }
        if (req.type === 'item') {
          const inv = user.inventory || [];
          if (!inv.includes(req.value)) {
            return interaction.reply({ embeds: [errorEmbed(`You need to own **${req.label || req.value}** before buying this.`)], ephemeral: true });
          }
        }
        if (req.type === 'role') {
          const hasRole = interaction.member.roles.cache.has(req.value);
          if (!hasRole) {
            return interaction.reply({ embeds: [errorEmbed(`You need the **${req.label || req.value}** role to buy this.`)], ephemeral: true });
          }
        }
      }

      user.wallet -= item.price;
      saveUser(interaction.user.id, user);
      giveItem(interaction.user.id, item.id);

      if (item.roleReward) {
        try { await interaction.member.roles.add(item.roleReward); } catch { }
      }

      await interaction.reply({ embeds: [purchaseEmbed(item, user.wallet)] });
    }

    if (sub === 'inventory') {
      const user  = getUser(interaction.user.id);
      const inv   = user.inventory || [];
      if (!inv.length) return interaction.reply({ embeds: [errorEmbed('Your inventory is empty.')], ephemeral: true });

      const store  = getStore();
      const counts = inv.reduce((a, id) => { a[id] = (a[id] || 0) + 1; return a; }, {});
      const lines  = Object.entries(counts).map(([id, cnt]) => {
        const item = store.items.find((i) => i.id === id);
        return `${item?.reusable ? '♻️' : '🗑️'} **${item ? item.name : id}** ×${cnt}`;
      });

      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(COLORS.SHOP).setTitle(`🎒 ${interaction.user.username}'s Inventory`).setDescription(lines.join('\n')).setTimestamp()],
      });
    }
  },
};
