// commands/economy/give.js
// /give — restricted by type:
//   money, item, gun, tokens = any user (from own inventory/wallet)
//   everything else = Admin/Owner only
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getOrCreateUser, getUser, saveUser, getStore, giveItem, removeItem, hasAccount, getConfig } = require('../../utils/db');
const { getBusiness, saveBusiness, getBusinesses } = require('../../utils/bizDb');
const { getGunInventory, saveGunInventory, getGunById } = require('../../utils/gunDb');
const { getPet, savePet, PET_TYPES } = require('../../utils/petDb');
const { getGangByMember, getAllGangs, saveGang } = require('../../utils/gangDb');
const { getPhone, savePhone, getStatusTier, getArtistTier } = require('../../utils/phoneDb');
const { getOrCreateCredit, saveCredit } = require('../../utils/creditDb');
const { getLaptop, saveLaptop } = require('../../utils/laptopDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator) ||
         member.permissions.has(PermissionFlagsBits.ManageGuild) ||
         member.guild.ownerId === member.id;
}

const ADMIN_TYPES = ['pet','gang','bizmoney','phonestatus','phonefollowers','phonehype',
                     'creditscore','artistfame','artisttier','laptopapp','heat'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give something to another user. Admin-only types are restricted.')
    .addUserOption(o => o.setName('user').setDescription('Who to give to').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('What to give').setRequired(true)
      .addChoices(
        { name:'💵 Money',                   value:'money'        },
        { name:'🎒 Store Item',              value:'item'         },
        { name:'🔫 Gun',                     value:'gun'          },
        { name:'🪙 Pet Tokens',              value:'tokens'       },
        { name:'🐾 Pet — Admin only',         value:'pet'         },
        { name:'🏴 Add to Gang — Admin only', value:'gang'        },
        { name:'🏢 Business Money — Admin',   value:'bizmoney'    },
        { name:'📱 Phone Status — Admin',     value:'phonestatus' },
        { name:'👥 Followers — Admin',        value:'phonefollowers' },
        { name:'✨ Hype — Admin',             value:'phonehype'   },
        { name:'📊 Credit Score — Admin',     value:'creditscore' },
        { name:'🎵 Artist Fame — Admin',      value:'artistfame'  },
        { name:'🎤 Artist Tier — Admin',      value:'artisttier'  },
        { name:'💻 Install Laptop App — Admin', value:'laptopapp' },
        { name:'🔥 Heat Level — Admin',       value:'heat'        },
      ))
    .addStringOption(o => o.setName('item_id').setDescription('Item or gun — type to search').setRequired(false).setAutocomplete(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount (money / tokens / status / followers / hype / fame / heat / credit delta)').setRequired(false).setMinValue(1))
    .addStringOption(o => o.setName('tier').setDescription('Artist tier to set (for artisttier type)').setRequired(false)
      .addChoices(
        { name:'🎙️ Unsigned',         value:'unsigned'     },
        { name:'🌆 Local Buzz',        value:'local_buzz'   },
        { name:'🎵 Indie Artist',      value:'indie_artist' },
        { name:'📻 Rising Star',       value:'rising_star'  },
        { name:'🎤 Mainstream',        value:'mainstream'   },
        { name:'🏆 Platinum Artist',   value:'platinum'     },
        { name:'👑 Music Legend',      value:'legend'       },
      )),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const type    = interaction.options.getString('type') || '';
    let choices = [];

    if (type === 'item') {
      const store = getStore(interaction.guildId);
      choices = (store.items||[]).map(i => ({
        name: `${i.emoji||'📦'} ${i.name} — $${(i.price||0).toLocaleString()}`,
        value: i.id,
      }));
    } else if (type === 'gun') {
      const { getGunShop } = require('../../utils/gunDb');
      choices = (getGunShop().guns||[]).map(g => ({
        name: `${g.emoji||'🔫'} ${g.name} — $${(g.price||0).toLocaleString()}`,
        value: g.id,
      }));
    } else if (type === 'pet') {
      choices = Object.entries(PET_TYPES).map(([id, p]) => ({
        name: `${p.emoji} ${p.name}`,
        value: id,
      }));
    } else if (type === 'gang') {
      const gangs = getAllGangs();
      choices = Object.values(gangs).map(g => ({
        name: `${g.color||''} ${g.name} (${(g.members||[]).length} members)`,
        value: g.id,
      }));
    } else if (type === 'laptopapp') {
      const { BUILTIN_APPS } = require('../../utils/laptopDb');
      choices = Object.entries(BUILTIN_APPS).map(([id, a]) => ({
        name: `${a.emoji} ${a.name} — ${a.desc}`,
        value: id,
      }));
    }

    const filtered = choices
      .filter(c => c.name.toLowerCase().includes(focused))
      .slice(0, 25);
    return interaction.respond(filtered.length ? filtered : [{ name:'No results', value:'__none__' }]).catch(()=>null);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const target = interaction.options.getUser('user');
    const type   = interaction.options.getString('type');
    const itemId = interaction.options.getString('item_id');
    const amount = interaction.options.getInteger('amount');
    const tier   = interaction.options.getString('tier');
    const userId = interaction.user.id;
    const admin  = isAdmin(interaction.member);

    if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't give to yourself.")], ephemeral:true });
    if (!hasAccount(target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> doesn't have an account yet.`)], ephemeral:true });

    // Block non-admins from admin-only types
    if (ADMIN_TYPES.includes(type) && !admin) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('🔒 Admin Only')
        .setDescription(`The **${type}** give type requires **Administrator** or **Manage Server** permission.`)
      ], ephemeral:true });
    }

    const fmtMoney = n => '$' + Math.round(n).toLocaleString();

    // ── MONEY ─────────────────────────────────────────────────────
    if (type === 'money') {
      if (!amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify an `amount:`.')], ephemeral:true });
      const giver = getOrCreateUser(userId);
      if (!admin && giver.wallet < amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You only have **${fmtMoney(giver.wallet)}** in your wallet.`)], ephemeral:true });
      if (!admin) { giver.wallet -= amount; saveUser(userId, giver); }
      const recv = getOrCreateUser(target.id);
      recv.wallet += amount;
      saveUser(target.id, recv);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
        .setTitle('💵 Money Sent')
        .setDescription(`<@${userId}> gave **${fmtMoney(amount)}** to <@${target.id}>!`)
        .addFields({ name:'Their Wallet', value:fmtMoney(recv.wallet), inline:true })
      ]});
    }

    // ── STORE ITEM ────────────────────────────────────────────────
    if (type === 'item') {
      if (!itemId || itemId === '__none__') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Type to search for an item in `item_id`.')], ephemeral:true });
      const store = getStore(interaction.guildId);
      const item  = store.items.find(i => i.id === itemId);
      if (!item) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Item not found. Use \`/shop\` to browse.`)], ephemeral:true });
      if (!admin) {
        const removed = removeItem(userId, itemId);
        if (!removed) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't have **${item.name}** in your inventory.`)], ephemeral:true });
      }
      giveItem(target.id, itemId);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x9b59b6)
        .setTitle(`🎒 ${item.name} Given`)
        .setDescription(`<@${userId}> gave **${item.name}** to <@${target.id}>!`)
      ]});
    }

    // ── GUN ───────────────────────────────────────────────────────
    if (type === 'gun') {
      if (!itemId || itemId === '__none__') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Type to search for a gun in `item_id`.')], ephemeral:true });
      if (admin) {
        const gun = getGunById(itemId);
        if (!gun) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Gun not found.')], ephemeral:true });
        const inv = getGunInventory(target.id);
        inv.push({ gunId:itemId, boughtAt:Date.now(), ammo:gun.capacity*3, gifted:true });
        await saveGunInventory(target.id, inv);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setTitle(`${gun.emoji} Gun Given`).setDescription(`${gun.emoji} **${gun.name}** given to <@${target.id}>!`)]});
      }
      const myInv = getGunInventory(userId);
      const idx   = myInv.findIndex(g => g.gunId === itemId);
      if (idx === -1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't have that gun. Use \`/guns\` to see yours.`)], ephemeral:true });
      const [g] = myInv.splice(idx, 1);
      await saveGunInventory(userId, myInv);
      const theirInv = getGunInventory(target.id);
      theirInv.push(g);
      await saveGunInventory(target.id, theirInv);
      const info = getGunById(itemId);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setTitle(`${info?.emoji||'🔫'} Gun Transferred`).setDescription(`<@${userId}> gave **${info?.name||itemId}** to <@${target.id}>!`)]});
    }

    // ── PET TOKENS ────────────────────────────────────────────────
    if (type === 'tokens') {
      if (!amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify an `amount:`.')], ephemeral:true });
      if (!admin) {
        const myPet = getPet(userId);
        if (!myPet || (myPet.tokens||0) < amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Not enough pet tokens.`)], ephemeral:true });
        myPet.tokens -= amount;
        await savePet(userId, myPet);
      }
      const theirPet = getPet(target.id);
      if (!theirPet) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> doesn't have a pet.`)], ephemeral:true });
      theirPet.tokens = (theirPet.tokens||0) + amount;
      await savePet(target.id, theirPet);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff6b35).setTitle('🪙 Tokens Given').setDescription(`**${amount} tokens** given to <@${target.id}>'s ${theirPet.emoji} ${theirPet.name}!`)]});
    }

    // ── ADMIN: PET ────────────────────────────────────────────────
    if (type === 'pet') {
      const petTypeId = itemId;
      if (!petTypeId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Type a pet type in `item_id`.')], ephemeral:true });
      const petType = PET_TYPES[petTypeId];
      if (!petType) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Pet type not found.')], ephemeral:true });
      if (getPet(target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> already has a pet.`)], ephemeral:true });
      await savePet(target.id, { type:petTypeId, name:petType.name, emoji:petType.emoji, level:1, xp:0, hp:petType.baseHp, hunger:100, happiness:100, bond:0, tokens:0, wins:0, losses:0, guardMode:false, ownerId:target.id, adoptedAt:Date.now() });
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff6b35).setTitle(`${petType.emoji} Pet Given!`).setDescription(`<@${target.id}> received a **${petType.name}**!`)]});
    }

    // ── ADMIN: GANG ───────────────────────────────────────────────
    if (type === 'gang') {
      const gangId = itemId;
      if (!gangId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Type a gang name in `item_id`.')], ephemeral:true });
      if (getGangByMember(target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> is already in a gang.`)], ephemeral:true });
      const gangs = getAllGangs();
      const gang  = Object.values(gangs).find(g => g.id === gangId);
      if (!gang) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Gang not found.')], ephemeral:true });
      gang.members.push({ userId:target.id, role:'Member', rep:0, joinedAt:Date.now() });
      await saveGang(gangId, gang);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setTitle('🏴 Added to Gang').setDescription(`<@${target.id}> added to **${gang.name}**!`)]});
    }

    // ── ADMIN: BUSINESS MONEY ─────────────────────────────────────
    if (type === 'bizmoney') {
      if (!amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify `amount:`.')], ephemeral:true });
      const bizList = getBusinesses(target.id);
      if (!bizList.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> has no businesses.`)], ephemeral:true });
      const biz = bizList[0];
      biz.revenue = (biz.revenue||0) + amount;
      await saveBusiness(target.id, biz);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff6b35).setTitle('🏢 Business Money Added').setDescription(`**${fmtMoney(amount)}** added to <@${target.id}>'s **${biz.name}** revenue.`)]});
    }

    // ── ADMIN: PHONE STATUS ───────────────────────────────────────
    if (type === 'phonestatus') {
      if (!amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify `amount:`.')], ephemeral:true });
      const phone = getPhone(target.id);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> has no phone.`)], ephemeral:true });
      phone.status = (phone.status||0) + amount;
      const newTier = getStatusTier(phone.status);
      await savePhone(target.id, phone);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xf5c518).setTitle('📱 Status Given').setDescription(`**+${amount.toLocaleString()}** status to <@${target.id}>.\nNew tier: **${newTier.label}**`)]});
    }

    // ── ADMIN: FOLLOWERS ──────────────────────────────────────────
    if (type === 'phonefollowers') {
      if (!amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify `amount:`.')], ephemeral:true });
      const phone = getPhone(target.id);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> has no phone.`)], ephemeral:true });
      phone.followers = (phone.followers||0) + amount;
      await savePhone(target.id, phone);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xf5c518).setTitle('👥 Followers Given').setDescription(`**+${amount.toLocaleString()}** followers to <@${target.id}>.`)]});
    }

    // ── ADMIN: HYPE ───────────────────────────────────────────────
    if (type === 'phonehype') {
      if (!amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify `amount:`.')], ephemeral:true });
      const phone = getPhone(target.id);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> has no phone.`)], ephemeral:true });
      phone.hype = (phone.hype||0) + amount;
      await savePhone(target.id, phone);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xf5c518).setTitle('✨ Hype Given').setDescription(`**+${amount.toLocaleString()}** hype to <@${target.id}>.`)]});
    }

    // ── ADMIN: CREDIT SCORE ───────────────────────────────────────
    if (type === 'creditscore') {
      if (!amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify `amount:` (can be negative to reduce).')], ephemeral:true });
      const credit = await getOrCreateCredit(target.id);
      credit.score = Math.max(300, Math.min(850, (credit.score||680) + amount));
      await saveCredit(target.id, credit);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('📊 Credit Score Adjusted').setDescription(`<@${target.id}>'s credit score: **${credit.score}**`)]});
    }

    // ── ADMIN: ARTIST FAME ────────────────────────────────────────
    if (type === 'artistfame') {
      if (!amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify `amount:`.')], ephemeral:true });
      const phone = getPhone(target.id);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> has no phone.`)], ephemeral:true });
      if (!phone.artistCareer) phone.artistCareer = { fame:0, tier:'unsigned' };
      phone.artistCareer.fame = Math.max(0, (phone.artistCareer.fame||0) + amount);
      const newTier = getArtistTier(phone.artistCareer.fame);
      phone.artistCareer.tier = newTier.id;
      await savePhone(target.id, phone);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff8080).setTitle('🎵 Artist Fame Given').setDescription(`**+${amount.toLocaleString()}** fame to <@${target.id}>.\nTier: **${newTier.label}**`)]});
    }

    // ── ADMIN: ARTIST TIER ────────────────────────────────────────
    if (type === 'artisttier') {
      if (!tier) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Select a `tier:` from the dropdown.')], ephemeral:true });
      const fameMap = { unsigned:0, local_buzz:500, indie_artist:2000, rising_star:8000, mainstream:25000, platinum:75000, legend:200000 };
      const phone   = getPhone(target.id);
      if (!phone) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> has no phone.`)], ephemeral:true });
      if (!phone.artistCareer) phone.artistCareer = { fame:0, tier:'unsigned' };
      phone.artistCareer.fame = fameMap[tier] || 0;
      phone.artistCareer.tier = tier;
      await savePhone(target.id, phone);
      const at = getArtistTier(phone.artistCareer.fame);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff8080).setTitle('🎤 Artist Tier Set').setDescription(`<@${target.id}> is now **${at.label}**!`)]});
    }

    // ── ADMIN: LAPTOP APP ─────────────────────────────────────────
    if (type === 'laptopapp') {
      const appId = itemId;
      if (!appId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Type to search for an app in `item_id`.')], ephemeral:true });
      const laptop = getLaptop(target.id) || { userId:target.id, apps:[] };
      if (!laptop.apps) laptop.apps = [];
      if (laptop.apps.find(a => a.id === appId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> already has **${appId}** installed.`)], ephemeral:true });
      laptop.apps.push({ id:appId, quality:5, installedAt:Date.now(), adminInstalled:true });
      await saveLaptop(target.id, laptop);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('💻 Laptop App Installed').setDescription(`**${appId}** (Quality 5) installed on <@${target.id}>'s laptop!`)]});
    }

    // ── ADMIN: HEAT ───────────────────────────────────────────────
    if (type === 'heat') {
      if (!amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify `amount:`.')], ephemeral:true });
      const user2 = getOrCreateUser(target.id);
      user2.heat  = Math.max(0, Math.min(100, (user2.heat||0) + amount));
      saveUser(target.id, user2);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xff6b35).setTitle('🔥 Heat Adjusted').setDescription(`<@${target.id}>'s heat: **${user2.heat}**`)]});
    }
  },
};
