const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, getUser, saveUser, getStore, giveItem, removeItem, hasAccount } = require('../../utils/db');
const { getBusiness, saveBusiness, BIZ_TYPES } = require('../../utils/bizDb');
const { getGunInventory, saveGunInventory, getGunShop, getGunById, getAllGuns } = require('../../utils/gunDb');
const { getPet, savePet, PET_TYPES } = require('../../utils/petDb');
const { getGangByMember, getAllGangs, saveGang } = require('../../utils/gangDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const { col } = require('../../utils/mongo');

function isAdmin(member) {
  return member.permissions.has('Administrator') || member.permissions.has('ManageGuild');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give something to another user.')
    .addUserOption(o => o.setName('user').setDescription('Who to give to').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('What to give').setRequired(true)
      .addChoices(
        { name:'🎒 Store Item',       value:'item'     },
        { name:'🔫 Gun',              value:'gun'      },
        { name:'💵 Money',            value:'money'    },
        { name:'🪙 Pet Tokens',       value:'tokens'   },
        // Admin only below
        { name:'🐾 Pet (Admin)',       value:'pet'      },
        { name:'🏴 Add to Gang (Admin)', value:'gang'  },
        { name:'🏢 Business Money (Admin)', value:'bizmoney' },
      ))
    .addStringOption(o => o.setName('item_id').setDescription('Item/Gun ID').setRequired(false).setAutocomplete(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount for money/tokens/bizmoney').setRequired(false).setMinValue(1))
    .addStringOption(o => o.setName('gang_id').setDescription('Gang ID (admin: add to gang)').setRequired(false)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const type    = interaction.options.getString('type') || '';
    const { getStore } = require('../../utils/db');
    const { getGunShop } = require('../../utils/gunDb');
    let choices = [];
    if (['item','drug'].includes(type)) {
      const store = getStore(interaction.guildId);
      choices = (store.items||[]).map(i => ({ name:`${i.name} (${i.id})`, value:i.id }));
    } else if (type === 'gun') {
      const guns = getGunShop().guns || [];
      choices = guns.map(g => ({ name:`${g.emoji||'🔫'} ${g.name} (${g.id}) — $${(g.price||0).toLocaleString()}`, value:g.id }));
    }
    const filtered = choices.filter(c => c.name.toLowerCase().includes(focused)).slice(0,25);
    return interaction.respond(filtered.length ? filtered : [{ name:'No items found', value:'__none__' }]);
  },
  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const target = interaction.options.getUser('user');
    const type   = interaction.options.getString('type');
    const itemId = interaction.options.getString('item_id');
    const amount = interaction.options.getInteger('amount');
    const gangId = interaction.options.getString('gang_id');
    const admin  = isAdmin(interaction.member);

    if (target.id === interaction.user.id) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't give to yourself.")], ephemeral:true });
    if (!hasAccount(target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> doesn't have an account yet.`)], ephemeral:true });

    // ── MONEY ───────────────────────────────────────────────────
    if (type === 'money') {
      if (!amount || amount < 1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify an amount with `amount:`.')], ephemeral:true });
      const giver = getOrCreateUser(interaction.user.id);
      if (!admin && giver.wallet < amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You only have **$${giver.wallet.toLocaleString()}** in your wallet.`)], ephemeral:true });
      if (!admin) { giver.wallet -= amount; saveUser(interaction.user.id, giver); }
      const receiver = getOrCreateUser(target.id);
      receiver.wallet += amount;
      saveUser(target.id, receiver);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
        .setTitle('💵 Money Sent')
        .setDescription(`<@${interaction.user.id}> gave **$${amount.toLocaleString()}** to <@${target.id}>!`)
        .addFields({ name:'💵 Their New Wallet', value:`$${receiver.wallet.toLocaleString()}`, inline:true })
      ]});
    }

    // ── STORE ITEM ───────────────────────────────────────────────
    if (type === 'item') {
      if (!itemId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify an `item_id`. Use `/shop` to see item IDs.')], ephemeral:true });
      const store = getStore(interaction.guildId);
      const item  = store.items.find(i => i.id === itemId);
      if (!item) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Item \`${itemId}\` not found. Use \`/shop\` to see available items.`)], ephemeral:true });

      // Non-admins must own the item
      if (!admin) {
        const removed = removeItem(interaction.user.id, itemId);
        if (!removed) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't have **${item.name}** in your inventory.`)], ephemeral:true });
      }
      giveItem(target.id, itemId);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x9b59b6)
        .setTitle(`🎒 ${item.name} Given`)
        .setDescription(`<@${interaction.user.id}> gave **${item.name}** to <@${target.id}>!`)
      ]});
    }

    // ── GUN ──────────────────────────────────────────────────────
    if (type === 'gun') {
      if (!itemId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a gun ID with `item_id`. Use `/gunshop` to see gun IDs.')], ephemeral:true });

      if (admin) {
        // Admin gives any gun from the shop
        const gun = getGunById(itemId);
        if (!gun) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Gun \`${itemId}\` not found.`)], ephemeral:true });
        const inv = getGunInventory(target.id);
        inv.push({ gunId: itemId, boughtAt: Date.now(), ammo: gun.capacity * 3, gifted: true });
        await saveGunInventory(target.id, inv);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
          .setTitle(`${gun.emoji} Gun Given`)
          .setDescription(`${gun.emoji} **${gun.name}** was given to <@${target.id}>!`)
        ]});
      } else {
        // Non-admin must own the gun
        const myInv = getGunInventory(interaction.user.id);
        const idx   = myInv.findIndex(g => g.gunId === itemId);
        if (idx === -1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't have \`${itemId}\` in your arsenal. Use \`/guns\` to see yours.`)], ephemeral:true });
        const [gun] = myInv.splice(idx, 1);
        await saveGunInventory(interaction.user.id, myInv);
        const theirInv = getGunInventory(target.id);
        theirInv.push(gun);
        await saveGunInventory(target.id, theirInv);
        const gunInfo = getGunById(itemId);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
          .setTitle(`${gunInfo?.emoji||'🔫'} Gun Transferred`)
          .setDescription(`<@${interaction.user.id}> gave their **${gunInfo?.name||itemId}** to <@${target.id}>!`)
        ]});
      }
    }

    // ── PET TOKENS ───────────────────────────────────────────────
    if (type === 'tokens') {
      if (!amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify an amount with `amount:`.')], ephemeral:true });
      const myPet = getPet(interaction.user.id);
      if (!admin) {
        if (!myPet) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have a pet to give tokens from.")], ephemeral:true });
        if ((myPet.tokens||0) < amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You only have **${myPet.tokens||0}** tokens.`)], ephemeral:true });
        myPet.tokens -= amount;
        await savePet(interaction.user.id, myPet);
      }
      const theirPet = getPet(target.id);
      if (!theirPet) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> doesn't have a pet.`)], ephemeral:true });
      theirPet.tokens = (theirPet.tokens||0) + amount;
      await savePet(target.id, theirPet);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff6b35)
        .setTitle('🪙 Pet Tokens Given')
        .setDescription(`<@${interaction.user.id}> gave **${amount} tokens** to <@${target.id}>'s ${theirPet.emoji} ${theirPet.name}!`)
      ]});
    }

    // ── ADMIN ONLY BELOW ─────────────────────────────────────────
    if (!admin) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`The **${type}** give type requires **Administrator** permission.`)], ephemeral:true });

    // ── PET (ADMIN) ──────────────────────────────────────────────
    if (type === 'pet') {
      if (!itemId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a pet type with `item_id` (e.g. `wolf`, `dragon`). Use `/petshop` to see types.')], ephemeral:true });
      const petType = PET_TYPES[itemId];
      if (!petType) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Pet type \`${itemId}\` not found.`)], ephemeral:true });
      if (getPet(target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> already has a pet.`)], ephemeral:true });
      await savePet(target.id, { type:itemId, name:petType.name, emoji:petType.emoji, level:1, xp:0, hp:petType.baseHp, hunger:100, happiness:100, bond:0, tokens:0, wins:0, losses:0, guardMode:false, ownerId:target.id, adoptedAt:Date.now() });
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff6b35)
        .setTitle(`${petType.emoji} Pet Given!`)
        .setDescription(`<@${target.id}> received a **${petType.name}**!`)
      ]});
    }

    // ── GANG (ADMIN) ─────────────────────────────────────────────
    if (type === 'gang') {
      if (!gangId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a gang ID with `gang_id`.')], ephemeral:true });
      if (getGangByMember(target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> is already in a gang.`)], ephemeral:true });
      const gangs = getAllGangs();
      const gang  = gangs.find(g => g.id === gangId);
      if (!gang) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Gang \`${gangId}\` not found.`)], ephemeral:true });
      gang.members.push({ userId:target.id, role:'Member', rep:0, joinedAt:Date.now() });
      await saveGang(gangId, gang);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
        .setTitle('🏴 Added to Gang')
        .setDescription(`<@${target.id}> was added to **${gang.color} ${gang.name}**!`)
      ]});
    }

    // ── BUSINESS MONEY (ADMIN) ───────────────────────────────────
    if (type === 'bizmoney') {
      if (!amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify an amount with `amount:`.')], ephemeral:true });
      const biz = getBusiness(target.id);
      if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> doesn't own a business.`)], ephemeral:true });
      biz.revenue = (biz.revenue||0) + amount;
      await saveBusiness(target.id, biz);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff6b35)
        .setTitle('🏢 Business Money Added')
        .setDescription(`**$${amount.toLocaleString()}** added to <@${target.id}>'s business revenue.`)
      ]});
    }
  },
};
