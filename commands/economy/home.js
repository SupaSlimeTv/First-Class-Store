// ============================================================
// commands/economy/home.js — /home
// Buy, upgrade, furnish, stash items, view home
// Gang leaders + business owners: 2 homes max
// Regular users: 1 home max
// ============================================================

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getStore, getConfig } = require('../../utils/db');
const { getHome, saveHome, deleteHome, HOME_TIERS, UPGRADE_PATH, FURNITURE_SHOP, calcPassiveIncome, getStashLimit } = require('../../utils/homeDb');
const { getBusiness } = require('../../utils/bizDb');
const { getGangByMember } = require('../../utils/gangDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();

function getHomeLimit(userId, guildId) {
  const isGangLeader = (() => { try { const g = getGangByMember(userId); return g?.leaderId === userId; } catch { return false; } })();
  const isBizOwner   = !!getBusiness(userId);
  return (isGangLeader || isBizOwner) ? 2 : 1;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('home')
    .setDescription('Buy, manage, and furnish your home.')
    .addSubcommand(s => s.setName('buy').setDescription('Purchase a home')
      .addStringOption(o => o.setName('tier').setDescription('Home tier').setRequired(true)
        .addChoices(...Object.entries(HOME_TIERS).map(([id,t]) => ({ name:`${t.name} — ${fmtMoney(t.cost)}`, value:id })))))
    .addSubcommand(s => s.setName('view').setDescription('View your home'))
    .addSubcommand(s => s.setName('furnish').setDescription('Browse and buy furnishings for your home'))
    .addSubcommand(s => s.setName('stash').setDescription('Manage your home stash')
      .addStringOption(o => o.setName('action').setDescription('Store or retrieve').setRequired(true)
        .addChoices({ name:'Store item', value:'store' }, { name:'Retrieve item', value:'retrieve' }))
      .addStringOption(o => o.setName('item_id').setDescription('Item ID').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('collect').setDescription('Collect passive income from your home'))
    .addSubcommand(s => s.setName('sell').setDescription('Sell your home (50% refund)')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const action  = interaction.options.getString('action');
    const userId  = interaction.user.id;
    const home    = getHome(userId);
    if (!home) return interaction.respond([]);

    if (action === 'store') {
      const user  = getOrCreateUser(userId);
      const store = getStore(interaction.guildId);
      const inv   = (user.inventory||[]);
      const counts= inv.reduce((a,id)=>{ a[id]=(a[id]||0)+1; return a; }, {});
      const choices = Object.entries(counts).map(([id,cnt]) => {
        const item = store.items.find(i=>i.id===id);
        return { name:`${item?.name||id} ×${cnt}`, value:id };
      }).filter(c=>c.name.toLowerCase().includes(focused)).slice(0,25);
      return interaction.respond(choices.length ? choices : [{ name:'Nothing to store', value:'__none__' }]);
    }
    if (action === 'retrieve') {
      const store = getStore(interaction.guildId);
      const stash = home.stash || [];
      const counts= stash.reduce((a,id)=>{ a[id]=(a[id]||0)+1; return a; }, {});
      const choices = Object.entries(counts).map(([id,cnt]) => {
        const item = store.items.find(i=>i.id===id);
        return { name:`${item?.name||id} ×${cnt}`, value:id };
      }).filter(c=>c.name.toLowerCase().includes(focused)).slice(0,25);
      return interaction.respond(choices.length ? choices : [{ name:'Stash is empty', value:'__none__' }]);
    }
    return interaction.respond([]);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const config = getConfig(interaction.guildId);

    // Get configurable home prices (admin can override in config)
    const getPrices = () => config.homePrices || {};

    // ── BUY ──────────────────────────────────────────────────
    if (sub === 'buy') {
      const tierId  = interaction.options.getString('tier');
      const tierDef = HOME_TIERS[tierId];
      const limit   = getHomeLimit(userId, interaction.guildId);
      const home    = getHome(userId);

      // Check home limit
      const owned = home ? (Array.isArray(home) ? home.length : 1) : 0;
      if (owned >= limit) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('🏠 Home Limit Reached')
        .setDescription(`You can own **${limit} home${limit>1?'s':''}** max.${limit===1?'\n\n*Gang leaders and business owners can own up to 2.*':''}`)
      ], ephemeral:true });

      // Already own this tier
      if (home && home.tier === tierId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You already own a **${tierDef.name}**.`)
      ], ephemeral:true });

      const price = getPrices()[tierId] || tierDef.cost;
      const user  = getOrCreateUser(userId);
      if (user.wallet < price) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You need **${fmtMoney(price)}** to buy a ${tierDef.name}. You have **${fmtMoney(user.wallet)}**.`)
      ], ephemeral:true });

      user.wallet -= price;
      saveUser(userId, user);
      await saveHome(userId, {
        tier: tierId, purchasedAt: Date.now(), furnishings: [],
        stash: [], lastCollected: Date.now(), isSafehouse: false,
      });

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`${tierDef.name} Purchased!`)
        .setDescription(`Welcome home! You just bought a **${tierDef.name}**.\n\n*${tierDef.desc}*`)
        .addFields(
          { name:'🔒 Stash Slots',     value:`${tierDef.stashSlots}`,                      inline:true },
          { name:'🛋️ Furnishing Slots', value:`${tierDef.furnSlots}`,                      inline:true },
          { name:'💰 Passive/hr',       value:fmtMoney(tierDef.passivePerHr),               inline:true },
        )
        .setFooter({ text:'Use /home furnish to decorate · /home stash to hide items' })
      ]});
    }

    // ── VIEW ──────────────────────────────────────────────────
    if (sub === 'view') {
      const home = getHome(userId);
      if (!home) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription("You don't own a home. Use `/home buy` to purchase one.")
      ], ephemeral:true });

      const tier     = HOME_TIERS[home.tier];
      const passive  = calcPassiveIncome(home);
      const stashMax = getStashLimit(home);
      const stashUsed= (home.stash||[]).length;
      const furnUsed = (home.furnishings||[]).length;
      const store    = getStore(interaction.guildId);

      const stashList = (home.stash||[]).length
        ? [...new Set(home.stash)].map(id => {
            const cnt  = home.stash.filter(x=>x===id).length;
            const item = store.items.find(i=>i.id===id);
            return `${item?.isDrug?'💊':'📦'} ${item?.name||id} ×${cnt}`;
          }).join('\n')
        : '*Empty*';

      const furnList = (home.furnishings||[]).length
        ? home.furnishings.map(f => {
            const fd = FURNITURE_SHOP.find(x=>x.id===f.id);
            return `${fd?.name||f.id}${f.used?' *(used)*':''}`;
          }).join('\n')
        : '*Unfurnished*';

      // Pending passive income
      const hrsSince  = (Date.now() - (home.lastCollected||Date.now())) / 3600000;
      const pending   = Math.floor(passive * hrsSince);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`${tier?.name||'🏠 Home'} — Your Property`)
        .setDescription(`*${tier?.desc||''}*${home.isSafehouse ? '\n\n🏴 **Designated as Gang Safehouse**' : ''}`)
        .addFields(
          { name:'📦 Stash',            value:`${stashUsed}/${stashMax} slots\n${stashList}`,      inline:true },
          { name:'🛋️ Furnishings',      value:`${furnUsed}/${tier?.furnSlots||0} slots\n${furnList}`, inline:true },
          { name:'💰 Passive Income',   value:`${fmtMoney(passive)}/hr\n💵 ${fmtMoney(pending)} ready`, inline:false },
        )
        .setFooter({ text:'/home collect · /home furnish · /home stash' })
      ]});
    }

    // ── FURNISH ───────────────────────────────────────────────
    if (sub === 'furnish') {
      const home = getHome(userId);
      if (!home) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription("You need a home first. Use `/home buy`.")
      ], ephemeral:true });

      const tier    = HOME_TIERS[home.tier];
      const furnUsed= (home.furnishings||[]).length;
      const furnMax = tier?.furnSlots || 0;

      // Include store items with isFurniture flag
      const store    = getStore(interaction.guildId);
      const storeFurn= (store.items||[]).filter(i => i.isFurniture);
      const allFurn  = [...FURNITURE_SHOP, ...storeFurn.map(i => ({
        id: i.id, name: i.name, cost: i.price, passiveBonus: 0, stashBonus: 0, desc: i.description,
      }))];

      const user = getOrCreateUser(userId);

      // Build select menu — show all items, mark owned and affordable
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('home_furn_select')
        .setPlaceholder('Choose a furnishing to buy...')
        .addOptions(allFurn.map(f => {
          const owned      = (home.furnishings||[]).filter(x=>x.id===f.id).length;
          const canAfford  = user.wallet >= f.cost;
          const slotsLeft  = furnUsed < furnMax;
          const statusIcon = !slotsLeft ? '🔒' : !canAfford ? '💸' : owned ? '✅' : '🛒';
          return new StringSelectMenuOptionBuilder()
            .setLabel(`${statusIcon} ${f.name.replace(/[^\w\s$]/g,'').trim().slice(0,50)}`)
            .setDescription(`${fmtMoney(f.cost)} — ${f.desc.slice(0,80)}${owned ? ` (owned ×${owned})` : ''}`)
            .setValue(f.id);
        }));

      const selectRow = new ActionRowBuilder().addComponents(selectMenu);

      // Build description lines
      const lines = allFurn.map(f => {
        const owned = (home.furnishings||[]).filter(x=>x.id===f.id).length;
        return `${f.name} — **${fmtMoney(f.cost)}**\n*${f.desc}*${owned ? ` ✅ ×${owned}` : ''}`;
      }).join('\n\n');

      await interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🛋️ Furniture Shop — ${furnUsed}/${furnMax} slots used`)
        .setDescription(lines)
        .setFooter({ text:`Wallet: ${fmtMoney(user.wallet)} · Select an item below to buy` })
      ], components:[selectRow], ephemeral:true });

      // Wait for selection
      const msg = await interaction.fetchReply();
      const selectCollector = msg.createMessageComponentCollector({ time: 60_000, max: 1 });

      selectCollector.on('collect', async selectInt => {
        if (selectInt.user.id !== userId) return;
        const furnId = selectInt.values[0];
        const furn   = allFurn.find(f => f.id === furnId);
        if (!furn) return selectInt.update({ content:'Item not found.', components:[] });

        // Validation
        const freshHome = getHome(userId);
        const freshUser = getOrCreateUser(userId);
        const freshUsed = (freshHome?.furnishings||[]).length;
        const freshMax  = HOME_TIERS[freshHome?.tier]?.furnSlots || 0;

        if (freshUsed >= freshMax) return selectInt.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`🔒 No furnishing slots left (${freshUsed}/${freshMax}). Upgrade your home.`)], components:[] });
        if (freshUser.wallet < furn.cost) return selectInt.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`💸 You need **${fmtMoney(furn.cost)}** — you only have **${fmtMoney(freshUser.wallet)}**.`)], components:[] });

        // Show confirmation
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`home_furn_confirm_${furnId}`).setLabel(`✅ Confirm — Buy ${furn.name}`).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('home_furn_cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary),
        );

        await selectInt.update({ embeds:[new EmbedBuilder()
          .setColor(0xf5c518)
          .setTitle(`🛋️ Confirm Purchase`)
          .setDescription(`**${furn.name}** — ${fmtMoney(furn.cost)}\n\n*${furn.desc}*\n\nWallet after purchase: **${fmtMoney(freshUser.wallet - furn.cost)}**`)
          .setFooter({ text:'Confirm to buy or cancel to go back' })
        ], components:[confirmRow] });

        // Wait for confirm/cancel
        const confirmCollector = msg.createMessageComponentCollector({ time: 30_000, max: 1 });
        confirmCollector.on('collect', async confirmInt => {
          if (confirmInt.user.id !== userId) return;

          if (confirmInt.customId === 'home_furn_cancel') {
            return confirmInt.update({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('Purchase cancelled.')], components:[] });
          }

          // Final check + purchase
          const buyHome = getHome(userId);
          const buyUser = getOrCreateUser(userId);
          if (buyUser.wallet < furn.cost) return confirmInt.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Not enough money.')], components:[] });
          if ((buyHome?.furnishings||[]).length >= (HOME_TIERS[buyHome?.tier]?.furnSlots||0)) return confirmInt.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No slots left.')], components:[] });

          buyUser.wallet -= furn.cost;
          buyHome.furnishings = [...(buyHome.furnishings||[]), { id: furnId, installedAt: Date.now() }];
          saveUser(userId, buyUser);
          await saveHome(userId, buyHome);

          const newPassive = calcPassiveIncome(buyHome);
          const newStash   = getStashLimit(buyHome);
          await confirmInt.update({ embeds:[new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle(`✅ ${furn.name} Installed!`)
            .setDescription(`*${furn.desc}*\n\n💰 Wallet: **${fmtMoney(buyUser.wallet)}**\n📊 Passive: **${fmtMoney(newPassive)}/hr** · Stash: **${newStash} slots**`)
            .setFooter({ text:'Use /home furnish again to buy more' })
          ], components:[] });
        });

        confirmCollector.on('end', (c, reason) => {
          if (reason === 'time') confirmInt?.editReply({ components:[] }).catch(()=>{});
        });
      });

      selectCollector.on('end', (c, reason) => {
        if (reason === 'time') interaction.editReply({ components:[] }).catch(()=>{});
      });

      return;
    }

    // ── STASH ─────────────────────────────────────────────────
    if (sub === 'stash') {
      const home   = getHome(userId);
      if (!home) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("No home. Use `/home buy`.")], ephemeral:true });

      const action = interaction.options.getString('action');
      const itemId = interaction.options.getString('item_id');
      if (itemId === '__none__') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Nothing to stash.')], ephemeral:true });

      const store = getStore(interaction.guildId);
      const item  = store.items.find(i => i.id === itemId);
      const stashMax = getStashLimit(home);

      if (action === 'store') {
        const user = getOrCreateUser(userId);
        if (!(user.inventory||[]).includes(itemId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't own \`${itemId}\`.`)], ephemeral:true });
        if ((home.stash||[]).length >= stashMax) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Your stash is full (${stashMax}/${stashMax} slots). Upgrade your home or add a Safe/Vault.`)], ephemeral:true });
        // Remove from inventory
        const idx = user.inventory.indexOf(itemId);
        user.inventory.splice(idx, 1);
        home.stash = [...(home.stash||[]), itemId];
        saveUser(userId, user); await saveHome(userId, home);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setDescription(`📦 **${item?.name||itemId}** stashed at home. Hidden from inventory searches.`)
        ], ephemeral:true });
      }

      if (action === 'retrieve') {
        if (!(home.stash||[]).includes(itemId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`\`${itemId}\` not in your stash.`)], ephemeral:true });
        const idx = home.stash.indexOf(itemId);
        home.stash.splice(idx, 1);
        const user = getOrCreateUser(userId);
        user.inventory = [...(user.inventory||[]), itemId];
        saveUser(userId, user); await saveHome(userId, home);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setDescription(`📦 **${item?.name||itemId}** retrieved from stash.`)
        ], ephemeral:true });
      }
    }

    // ── COLLECT ───────────────────────────────────────────────
    if (sub === 'collect') {
      const home = getHome(userId);
      if (!home) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("No home. Use `/home buy`.")], ephemeral:true });

      const passive  = calcPassiveIncome(home);
      const hrsSince = (Date.now() - (home.lastCollected||Date.now())) / 3600000;
      const earned   = Math.floor(passive * hrsSince);

      if (earned < 1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888)
        .setDescription('Nothing to collect yet. Check back later!')
      ], ephemeral:true });

      const user = getOrCreateUser(userId);

      // Separate dirty vs clean based on furnishings
      const hasDrugLab  = (home.furnishings||[]).some(f => ['drug_lab','grow_house'].includes(f.id));
      const hasMiningRig= (home.furnishings||[]).some(f => f.id === 'mining_rig');
      const dirtyEarned = hasDrugLab   ? Math.floor(earned * 0.4) : 0;
      const cleanEarned = earned - dirtyEarned;

      user.wallet += cleanEarned;
      saveUser(userId, user);
      home.lastCollected = Date.now();

      // Add dirty money to gang if applicable
      if (dirtyEarned > 0) {
        const gang = getGangByMember(userId);
        if (gang) {
          const { getGangGoons, saveGangGoons } = require('../../utils/goonDb');
          const gd = getGangGoons(gang.id);
          gd.dirtyMoney = (gd.dirtyMoney||0) + dirtyEarned;
          await saveGangGoons(gang.id, gd);
        }
      }
      await saveHome(userId, home);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🏠 Home Income Collected')
        .setDescription(`Collected **${fmtMoney(earned)}** from your ${HOME_TIERS[home.tier]?.name||'home'}!`)
        .addFields(
          { name:'💵 Clean Income',  value:fmtMoney(cleanEarned), inline:true },
          ...(dirtyEarned ? [{ name:'💊 Dirty Money', value:fmtMoney(dirtyEarned), inline:true }] : []),
          { name:'💰 Wallet',        value:fmtMoney(user.wallet), inline:true },
        )
      ]});
    }

    // ── SELL ──────────────────────────────────────────────────
    if (sub === 'sell') {
      const home = getHome(userId);
      if (!home) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't own a home.")], ephemeral:true });

      const tier   = HOME_TIERS[home.tier];
      const config = getConfig(interaction.guildId);
      const price  = (config.homePrices||{})[home.tier] || tier.cost;
      const refund = Math.floor(price * 0.5);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('home_sell_confirm').setLabel(`Sell for ${fmtMoney(refund)}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('home_sell_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('⚠️ Sell Your Home?')
        .setDescription(`Sell your **${tier?.name}** for **${fmtMoney(refund)}** (50% refund)?\n\n⚠️ All furnishings and stashed items will be lost!`)
      ], components:[row], ephemeral:true });

      const msg = await interaction.fetchReply();
      const coll = msg.createMessageComponentCollector({ time:30_000 });
      coll.on('collect', async btn => {
        coll.stop();
        if (btn.customId === 'home_sell_cancel') return btn.update({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('Cancelled.')], components:[] });
        const user = getOrCreateUser(userId);
        user.wallet += refund;
        saveUser(userId, user);
        await deleteHome(userId);
        await btn.update({ embeds:[new EmbedBuilder().setColor(0x888888)
          .setTitle('🏠 Home Sold')
          .setDescription(`Your ${tier?.name} was sold for **${fmtMoney(refund)}**.`)
        ], components:[] });
      });
    }
  },
};
