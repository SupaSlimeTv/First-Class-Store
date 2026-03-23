const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getStore, giveItem, getConfig } = require('../../utils/db');
const { shopEmbed, errorEmbed, COLORS } = require('../../utils/embeds');
const { noAccount } = require('../../utils/accountCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse or buy items from the store.')
    .addSubcommand(s => s.setName('browse').setDescription('See all available items'))
    .addSubcommand(s => s.setName('buy').setDescription('Buy an item').addStringOption(o => o.setName('item_id').setDescription('Item ID').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('inventory').setDescription('View your inventory')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const { getStore } = require('../../utils/db');
    const store   = getStore();
    const choices = (store.items||[])
      .filter(i => i.name.toLowerCase().includes(focused) || i.id.includes(focused))
      .slice(0,25)
      .map(i => ({ name:`${i.name} — $${(i.price||0).toLocaleString()} (${i.id})`, value:i.id }));
    return interaction.respond(choices.length ? choices : [{ name:'No items', value:'__none__' }]);
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
      const itemId = interaction.options.getString('item_id').toLowerCase();
      const item   = store.items.find(i => i.id === itemId);
      if (!item || !item.enabled) return interaction.reply({ embeds: [errorEmbed(`Item \`${itemId}\` not found.`)], ephemeral: true });

      const user = getOrCreateUser(interaction.user.id);
      const total = user.wallet + user.bank;

      // Check requirements
      const req = item.requirements;
      if (req) {
        if (req.type === 'balance' && total < req.value) return interaction.reply({ embeds: [errorEmbed(`You need **$${req.value.toLocaleString()}** total balance to buy this.`)], ephemeral: true });
        if (req.type === 'item' && !(user.inventory||[]).includes(req.value)) return interaction.reply({ embeds: [errorEmbed(`You need to own **${req.label||req.value}** to buy this.`)], ephemeral: true });
        if (req.type === 'role' && !interaction.member.roles.cache.has(req.value)) return interaction.reply({ embeds: [errorEmbed(`You need the **${req.label||req.value}** role to buy this.`)], ephemeral: true });
      }

      if (user.wallet < item.price) return interaction.reply({ embeds: [errorEmbed(`You need **$${item.price.toLocaleString()}** in your wallet. You have **$${user.wallet.toLocaleString()}**.`)], ephemeral: true });

      user.wallet -= item.price;
      giveItem(interaction.user.id, itemId);

      // Grant role if configured (legacy roleReward field)
      if (item.roleReward) {
        await interaction.member.roles.add(item.roleReward).catch(() => {});
      }

      saveUser(interaction.user.id, user);

      // ---- EXECUTE EFFECT ON BUY if trigger is 'buy' ----
      let extraDesc = '';
      if (item.effect && item.trigger === 'buy') {
        const { executeEffect } = require('../../utils/effects');
        const buyResult = await executeEffect(item, interaction.user.id, null, interaction.member);
        if (buyResult.success && buyResult.description) extraDesc = `\n\n${buyResult.description}`;
        // Handle role edit on buy
        if (buyResult.needsRoleEdit) {
          const roleObj = interaction.guild.roles.cache.get(buyResult.roleId);
          if (buyResult.action === 'add') await interaction.member.roles.add(buyResult.roleId).catch(() => {});
          else await interaction.member.roles.remove(buyResult.roleId).catch(() => {});
          extraDesc = `\n\n🏅 Role **${roleObj?.name || buyResult.roleId}** ${buyResult.action === 'add' ? 'added' : 'removed'}.`;
        }
      }

      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle(`✅ Purchased: ${item.name}`).setDescription(`You bought **${item.name}** for **$${item.price.toLocaleString()}**.\n\n${item.description||''}${extraDesc}`).addFields({name:'💵 Remaining Wallet',value:`$${user.wallet.toLocaleString()}`,inline:true})] });
    }
  },
};
