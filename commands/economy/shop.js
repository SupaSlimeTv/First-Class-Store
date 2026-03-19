const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getStore, giveItem, getConfig } = require('../../utils/db');
const { shopEmbed, errorEmbed, COLORS } = require('../../utils/embeds');
const { noAccount } = require('../../utils/accountCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse or buy items from the store.')
    .addSubcommand(s => s.setName('browse').setDescription('See all available items'))
    .addSubcommand(s => s
      .setName('buy')
      .setDescription('Buy an item from the store')
      .addStringOption(o => o
        .setName('item')
        .setDescription('Search for an item to buy')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addIntegerOption(o => o
        .setName('quantity')
        .setDescription('How many to buy (default: 1)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(99)
      )
    )
    .addSubcommand(s => s.setName('inventory').setDescription('View your inventory')),

  // ---- AUTOCOMPLETE: show store items matching what user typed ----
  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'buy') return;
    const store   = getStore();
    const typed   = interaction.options.getFocused().toLowerCase();
    const enabled = (store.items || []).filter(i => i.enabled);
    const choices = enabled
      .filter(i => i.name.toLowerCase().includes(typed) || (i.description||'').toLowerCase().includes(typed))
      .slice(0, 25)
      .map(i => ({ name: `${i.name} — $${i.price.toLocaleString()}`, value: i.id }));
    await interaction.respond(choices.length ? choices : [{ name: 'No matching items', value: '__none__' }]);
  },

  async execute(interaction) {
    const sub   = interaction.options.getSubcommand();
    const store = getStore();

    if (sub === 'browse') {
      const enabled = store.items.filter(i => i.enabled);
      if (!enabled.length) return interaction.reply({ embeds: [errorEmbed('The store is empty right now.')], ephemeral: true });
      return interaction.reply({ embeds: [shopEmbed(enabled)] });
    }

    if (await noAccount(interaction)) return;

    if (sub === 'inventory') {
      const user  = getOrCreateUser(interaction.user.id);
      const inv   = user.inventory || [];
      if (!inv.length) return interaction.reply({ embeds: [errorEmbed('Your inventory is empty.')], ephemeral: true });
      const counts = inv.reduce((a, id) => { a[id] = (a[id]||0)+1; return a; }, {});
      const lines  = Object.entries(counts).map(([id, cnt]) => {
        const item = store.items.find(i => i.id === id);
        return `${item?.reusable ? '♻️' : '🗑️'} **${item ? item.name : id}** ×${cnt} — \`/use ${id}\``;
      });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.SHOP).setTitle(`🎒 Your Inventory`).setDescription(lines.join('\n'))] });
    }

    if (sub === 'buy') {
      const itemId  = interaction.options.getString('item');
      const qty     = interaction.options.getInteger('quantity') || 1;

      if (itemId === '__none__') return interaction.reply({ embeds: [errorEmbed('No item selected.')], ephemeral: true });

      const item = store.items.find(i => i.id === itemId);
      if (!item || !item.enabled) return interaction.reply({ embeds: [errorEmbed(`That item isn't available.`)], ephemeral: true });

      if (await noAccount(interaction)) return;
      const user  = getOrCreateUser(interaction.user.id);
      const total = user.wallet + user.bank;

      // Check requirements (only checked once regardless of qty)
      const req = item.requirements;
      if (req) {
        if (req.type === 'balance' && total < req.value) return interaction.reply({ embeds: [errorEmbed(`You need **$${req.value.toLocaleString()}** total balance to buy this.`)], ephemeral: true });
        if (req.type === 'item' && !(user.inventory||[]).includes(req.value)) return interaction.reply({ embeds: [errorEmbed(`You need to own **${req.label||req.value}** to buy this.`)], ephemeral: true });
        if (req.type === 'role' && !interaction.member.roles.cache.has(req.value)) return interaction.reply({ embeds: [errorEmbed(`You need the **${req.label||req.value}** role to buy this.`)], ephemeral: true });
      }

      const totalCost = item.price * qty;
      if (user.wallet < totalCost) return interaction.reply({ embeds: [errorEmbed(`You need **$${totalCost.toLocaleString()}** in your wallet for ${qty}× **${item.name}**.\nYou have **$${user.wallet.toLocaleString()}**.`)], ephemeral: true });

      user.wallet -= totalCost;
      for (let i = 0; i < qty; i++) giveItem(interaction.user.id, itemId);

      // Grant role if configured
      if (item.roleReward) await interaction.member.roles.add(item.roleReward).catch(() => {});

      saveUser(interaction.user.id, user);

      // ---- EXECUTE EFFECT ON BUY if trigger is 'buy' ----
      let extraDesc = '';
      if (item.effect && item.trigger === 'buy') {
        const { executeEffect } = require('../../utils/effects');
        const buyResult = await executeEffect(item, interaction.user.id, null, interaction.member);
        if (buyResult.success && buyResult.description) extraDesc = `\n\n${buyResult.description}`;
        if (buyResult.needsRoleEdit) {
          const roleObj = interaction.guild.roles.cache.get(buyResult.roleId);
          if (buyResult.action === 'add') await interaction.member.roles.add(buyResult.roleId).catch(() => {});
          else await interaction.member.roles.remove(buyResult.roleId).catch(() => {});
          extraDesc = `\n\n🏅 Role **${roleObj?.name || buyResult.roleId}** ${buyResult.action === 'add' ? 'added' : 'removed'}.`;
        }
      }

      const qtyLabel = qty > 1 ? ` ×${qty}` : '';
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(`✅ Purchased: ${item.name}${qtyLabel}`)
        .setDescription(`You bought **${qty}× ${item.name}** for **$${totalCost.toLocaleString()}**.\n\n${item.description||''}${extraDesc}`)
        .addFields({ name:'💵 Remaining Wallet', value:`$${user.wallet.toLocaleString()}`, inline:true })
      ]});
    }
  },
};
