// ============================================================
// commands/economy/sell.js
// List items, guns, pets, or drugs for sale to another player
// Autocomplete shows what the seller actually owns
// ============================================================

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser, getStore, removeItem } = require('../../utils/db');
const { getGunInventory, saveGunInventory, GUN_DATA } = require('../../utils/gunDb');
const { getPet, savePet } = require('../../utils/petDb');
const { getPhone, savePhone, PHONE_TYPES } = require('../../utils/phoneDb');
const { getBusiness, saveBusiness, deleteBusiness, BIZ_TYPES } = require('../../utils/bizDb');
const { col } = require('../../utils/mongo');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('List something for sale to another player.')
    .addUserOption(o => o.setName('buyer').setDescription('Who to offer the sale to').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('What type of thing are you selling?').setRequired(true)
      .addChoices(
        { name:'🎒 Store Item',  value:'item'  },
        { name:'🔫 Gun',         value:'gun'   },
        { name:'🐾 Pet',         value:'pet'   },
        { name:'📱 Phone',       value:'phone' },
        { name:'🏢 Business',     value:'business' },
      ))
    .addIntegerOption(o => o.setName('price').setDescription('Asking price ($)').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('item_id').setDescription('Item or gun ID (use autocomplete)').setRequired(false).setAutocomplete(true)),
  async autocomplete(interaction) {
    const userId  = interaction.user.id;
    const type    = interaction.options.getString('type');
    const focused = interaction.options.getFocused().toLowerCase();

    if (type === 'item') {
      const user  = getOrCreateUser(userId);
      const store = getStore();
      const inv   = user.inventory || [];
      const counts= inv.reduce((a,id)=>{ a[id]=(a[id]||0)+1; return a; }, {});
      const choices = Object.entries(counts).map(([id, cnt]) => {
        const item = store.items.find(i => i.id === id);
        const name = item ? `${item.name}${cnt>1?` ×${cnt}`:''}${item.isDrug?' 💊':''}` : id;
        return { name, value: id };
      }).filter(c => c.name.toLowerCase().includes(focused)).slice(0,25);
      return interaction.respond(choices.length ? choices : [{ name:'Nothing to sell', value:'__empty__' }]);
    }

    if (type === 'gun') {
      const inv = getGunInventory(userId);
      const choices = inv.map(g => {
        const gd = GUN_DATA?.[g.gunId] || {};
        return { name:`${gd.name||g.gunId} (${g.gunId}) HP:${g.hp||100}`, value: g.gunId + '::' + (inv.indexOf(g)) };
      }).filter(c => c.name.toLowerCase().includes(focused)).slice(0,25);
      return interaction.respond(choices.length ? choices : [{ name:'No guns to sell', value:'__empty__' }]);
    }

    if (type === 'pet') {
      const pet = getPet(userId);
      if (!pet) return interaction.respond([{ name:'No pet to sell', value:'__empty__' }]);
      return interaction.respond([{ name:`${pet.emoji||'🐾'} ${pet.name} (Lv.${pet.level})`, value:'pet' }]);
    }

    if (type === 'phone') {
      const phone = getPhone(userId);
      if (!phone) return interaction.respond([{ name:'No phone to sell', value:'__empty__' }]);
      const pt = PHONE_TYPES[phone.type] || PHONE_TYPES.standard;
      return interaction.respond([{ name:`${pt.emoji} ${pt.name} — Status: ${phone.status||0}`, value:'phone' }]);
    }

    if (type === 'business') {
      const biz = getBusiness(userId);
      if (!biz) return interaction.respond([{ name:'No business to sell', value:'__empty__' }]);
      const bt  = BIZ_TYPES[biz.type] || {};
      return interaction.respond([{ name:`${bt.emoji||'🏢'} ${biz.name} (Lv.${biz.level||1}) — Rev: $${(biz.revenue||0).toLocaleString()}`, value:'business' }]);
    }

    return interaction.respond([]);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;

    const buyer   = interaction.options.getUser('buyer');
    const type    = interaction.options.getString('type');
    const itemArg = interaction.options.getString('item_id') || '';
    const price   = interaction.options.getInteger('price');
    const userId  = interaction.user.id;

    if (buyer.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't sell to yourself.")], ephemeral:true });
    if (buyer.bot)           return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't sell to bots.")], ephemeral:true });
    if (itemArg === '__empty__') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Nothing to sell.")], ephemeral:true });

    // Validate seller owns the item
    let itemLabel = '';
    let itemEmoji = '';

    if (type === 'item') {
      const user  = getOrCreateUser(userId);
      const store = getStore();
      if (!(user.inventory||[]).includes(itemArg)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't own \`${itemArg}\`.`)], ephemeral:true });
      const storeItem = store.items.find(i => i.id === itemArg);
      itemLabel = storeItem ? storeItem.name : itemArg;
      itemEmoji = storeItem?.isDrug ? '💊' : '🎒';
    } else if (type === 'gun') {
      const inv = getGunInventory(userId);
      if (!inv.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have any guns.")], ephemeral:true });
      const gunId = itemArg.includes('::') ? itemArg.split('::')[0] : itemArg;
      const gun   = inv.find(g => g.gunId === gunId);
      if (!gun) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't own gun \`${gunId}\`.`)], ephemeral:true });
      itemLabel = GUN_DATA?.[gunId]?.name || gunId;
      itemEmoji = '🔫';
    } else if (type === 'pet') {
      const pet = getPet(userId);
      if (!pet) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have a pet.")], ephemeral:true });
      itemLabel = `${pet.emoji||'🐾'} ${pet.name} (Lv.${pet.level})`;
      itemEmoji = '🐾';
    } else if (type === 'phone') {
      const phone = getPhone(userId);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have a phone.")], ephemeral:true });
      const pt = PHONE_TYPES[phone.type] || PHONE_TYPES.standard;
      itemLabel = `${pt.emoji} ${pt.name}`;
      itemEmoji = '📱';
    } else if (type === 'business') {
      const biz = getBusiness(userId);
      if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a business.")], ephemeral:true });
      const bt  = BIZ_TYPES[biz.type] || {};
      itemLabel = `${bt.emoji||'🏢'} ${biz.name} (Lv.${biz.level||1}) — Revenue: $${(biz.revenue||0).toLocaleString()} · ${(biz.employees||[]).length} employees`;
      itemEmoji = '🏢';
    }

    await interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(0xf5c518)
      .setTitle(`${itemEmoji} Trade Offer`)
      .setDescription(`<@${userId}> is offering **${itemLabel}** to <@${buyer.id}> for **$${price.toLocaleString()}**.\n\n<@${buyer.id}> — do you accept?`)
      .setFooter({ text:'Expires in 60 seconds' })
    ], components:[new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sell_accept').setLabel('✅ Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('sell_decline').setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
    )]});

    const collector = interaction.channel.createMessageComponentCollector({
      filter: btn => btn.user.id === buyer.id,
      time: 60_000, max: 1,
    });

    collector.on('collect', async btn => {
      if (btn.customId === 'sell_decline') {
        return btn.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${buyer.id}> declined the offer.`)], components:[] });
      }

      // Check buyer has enough money
      const buyerData = getOrCreateUser(buyer.id);
      if ((buyerData.wallet + buyerData.bank) < price) {
        return btn.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${buyer.id}> can't afford $${price.toLocaleString()}.`)], components:[] });
      }

      // Deduct from buyer
      let remaining = price;
      const fromWallet = Math.min(remaining, buyerData.wallet);
      buyerData.wallet -= fromWallet; remaining -= fromWallet;
      if (remaining > 0) buyerData.bank = Math.max(0, buyerData.bank - remaining);

      // Pay seller
      const sellerData = getOrCreateUser(userId);
      sellerData.wallet += price;
      saveUser(buyer.id, buyerData);
      saveUser(userId, sellerData);

      // Transfer the item
      if (type === 'item') {
        removeItem(userId, itemArg);
        buyerData.inventory = [...(buyerData.inventory||[]), itemArg];
        saveUser(buyer.id, buyerData);
      } else if (type === 'gun') {
        const gunId   = itemArg.includes('::') ? itemArg.split('::')[0] : itemArg;
        const selInv  = getGunInventory(userId);
        const gIdx    = selInv.findIndex(g => g.gunId === gunId);
        const [gun]   = selInv.splice(gIdx, 1);
        await saveGunInventory(userId, selInv);
        const buyInv  = getGunInventory(buyer.id);
        buyInv.push(gun);
        await saveGunInventory(buyer.id, buyInv);
      } else if (type === 'pet') {
        const pet = getPet(userId);
        await savePet(buyer.id, { ...pet, ownerId: buyer.id });
        await savePet(userId, null);
      } else if (type === 'phone') {
        const phone = getPhone(userId);
        await savePhone(buyer.id, { ...phone });
        await savePhone(userId, null);
      } else if (type === 'business') {
        const biz = getBusiness(userId);
        // Transfer all business data to new owner, generate new routing number
        await saveBusiness(buyer.id, { ...biz, previousOwner: userId, soldAt: Date.now() });
        await deleteBusiness(userId);
        // Invalidate old routing number, new one auto-generated on next /myrouting call
        try {
          const rc = await col('routingNumbers');
          await rc.deleteOne({ _id: userId });
        } catch {}
      }

      return btn.update({ embeds:[new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle('✅ Trade Complete')
        .setDescription(`<@${buyer.id}> bought **${itemLabel}** from <@${userId}> for **$${price.toLocaleString()}**.`)
      ], components:[] });
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') interaction.editReply({ components:[] }).catch(()=>{});
    });
  },
};
