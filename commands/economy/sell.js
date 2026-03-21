const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser, getStore, removeItem, giveItem, hasAccount } = require('../../utils/db');
const { getGunInventory, saveGunInventory, getGunById } = require('../../utils/gunDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Sell an item or gun to another player for a set price.')
    .addUserOption(o => o.setName('buyer').setDescription('Who to sell to').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('What to sell').setRequired(true)
      .addChoices(
        { name:'🎒 Store Item', value:'item' },
        { name:'🔫 Gun',        value:'gun'  },
      ))
    .addStringOption(o => o.setName('item_id').setDescription('Item or Gun ID').setRequired(true))
    .addIntegerOption(o => o.setName('price').setDescription('Your asking price ($)').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const buyer  = interaction.options.getUser('buyer');
    const type   = interaction.options.getString('type');
    const itemId = interaction.options.getString('item_id');
    const price  = interaction.options.getInteger('price');
    const seller = interaction.user;

    if (buyer.id === seller.id) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't sell to yourself.")], ephemeral:true });
    if (!hasAccount(buyer.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${buyer.id}> doesn't have an account yet.`)], ephemeral:true });

    // Verify seller owns the item
    let itemName = itemId, itemEmoji = '🎒';

    if (type === 'item') {
      const store = getStore();
      const item  = store.items.find(i => i.id === itemId);
      if (!item) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Item \`${itemId}\` not found in the store.`)], ephemeral:true });
      const sellerData = getOrCreateUser(seller.id);
      if (!sellerData.inventory?.includes(itemId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't own **${item.name}**.`)], ephemeral:true });
      itemName = item.name; itemEmoji = '🎒';
    } else if (type === 'gun') {
      const inv = getGunInventory(seller.id);
      const has = inv.find(g => g.gunId === itemId);
      if (!has) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't have \`${itemId}\` in your arsenal.`)], ephemeral:true });
      const gunInfo = getGunById(itemId);
      itemName = gunInfo?.name || itemId; itemEmoji = gunInfo?.emoji || '🔫';
    }

    // Send trade offer to buyer
    const embed = new EmbedBuilder()
      .setColor(0xf5c518)
      .setTitle('💰 Trade Offer')
      .setDescription(`<@${seller.id}> wants to sell you ${itemEmoji} **${itemName}** for **$${price.toLocaleString()}**.\n\nDo you accept?`)
      .addFields(
        { name:'📦 Item',  value:`${itemEmoji} ${itemName}`, inline:true },
        { name:'💵 Price', value:`$${price.toLocaleString()}`, inline:true },
        { name:'⏱️ Expires', value:'60 seconds', inline:true },
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sell_accept').setLabel('✅ Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('sell_decline').setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
    );

    await interaction.reply({ content:`<@${buyer.id}> — you have a trade offer!`, embeds:[embed], components:[row] });
    const msg = await interaction.fetchReply();

    const collector = msg.createMessageComponentCollector({ time: 60_000 });

    collector.on('collect', async btn => {
      // Only the buyer can respond
      if (btn.user.id !== buyer.id) return btn.reply({ content:'Only the buyer can respond to this offer.', ephemeral:true });

      if (btn.customId === 'sell_decline') {
        await btn.update({ embeds:[new EmbedBuilder().setColor(0x888888).setTitle('❌ Trade Declined').setDescription(`<@${buyer.id}> declined the offer.`)], components:[] });
        return collector.stop();
      }

      // Accept — process transaction
      const buyerData = getOrCreateUser(buyer.id);
      if (buyerData.wallet < price) {
        await btn.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ Insufficient Funds').setDescription(`<@${buyer.id}> only has **$${buyerData.wallet.toLocaleString()}** — not enough for **$${price.toLocaleString()}**.`)], components:[] });
        return collector.stop();
      }

      try {
        if (type === 'item') {
          const removed = removeItem(seller.id, itemId);
          if (!removed) {
            await btn.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${seller.id}> no longer has this item.`)], components:[] });
            return collector.stop();
          }
          giveItem(buyer.id, itemId);
        } else {
          const sellerInv = getGunInventory(seller.id);
          const idx = sellerInv.findIndex(g => g.gunId === itemId);
          if (idx === -1) {
            await btn.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${seller.id}> no longer has this gun.`)], components:[] });
            return collector.stop();
          }
          const [gun] = sellerInv.splice(idx, 1);
          await saveGunInventory(seller.id, sellerInv);
          const buyerInv = getGunInventory(buyer.id);
          buyerInv.push(gun);
          await saveGunInventory(buyer.id, buyerInv);
        }

        // Transfer money
        buyerData.wallet -= price;
        saveUser(buyer.id, buyerData);
        const sellerData = getOrCreateUser(seller.id);
        sellerData.wallet += price;
        saveUser(seller.id, sellerData);

        await btn.update({ embeds:[new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('✅ Trade Complete!')
          .setDescription(`${itemEmoji} **${itemName}** sold to <@${buyer.id}> for **$${price.toLocaleString()}**!`)
          .addFields(
            { name:`💵 ${buyer.username} paid`,    value:`$${price.toLocaleString()}`, inline:true },
            { name:`💰 ${seller.username} received`, value:`$${price.toLocaleString()}`, inline:true },
          )
        ], components:[] });
      } catch(e) {
        await btn.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Trade failed: ${e.message}`)], components:[] });
      }
      collector.stop();
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') {
        interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x888888).setTitle('⏱️ Trade Expired').setDescription('No response from buyer in 60 seconds.')], components:[] }).catch(()=>{});
      }
    });
  },
};
