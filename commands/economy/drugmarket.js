// ============================================================
// commands/economy/drugmarket.js — /drugmarket
// Browse available drugs. Burner phones can order cross-border.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, isBotBanned } = require('../../utils/db');
const { getPhone } = require('../../utils/phoneDb');
const { getDrugs, getDrug, getPendingOrder, setPendingOrder, clearPendingOrder } = require('../../utils/drugDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const ORDER_COOLDOWN = 45 * 60 * 1000; // 45 min between orders
const orderCooldowns = new Map();
const BUST_CHANCE    = 0.15; // 15% base bust chance

module.exports = {
  data: new SlashCommandBuilder()
    .setName('drugmarket')
    .setDescription('Browse the drug market. Burner phone required to order.')
    .addSubcommand(s => s.setName('browse').setDescription('View available drugs and prices'))
    .addSubcommand(s => s.setName('order').setDescription('Order drugs across the border (burner phone required)')
      .addStringOption(o => o.setName('drug').setDescription('Drug to order').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('quantity').setDescription('How many units').setRequired(true).setMinValue(1).setMaxValue(10))),

  async autocomplete(interaction) {
    const drugs = getDrugs().filter(d => d.available);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = drugs
      .map(d => ({ name:`${d.emoji||'💊'} ${d.name} — $${d.price.toLocaleString()}/unit`, value:d.id }))
      .filter(c => c.name.toLowerCase().includes(focused))
      .slice(0,25);
    return interaction.respond(choices.length ? choices : [{ name:'No drugs available', value:'__none__' }]);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    if (isBotBanned(interaction.user.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You are silenced.')], ephemeral:true });

    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // ── BROWSE ───────────────────────────────────────────────
    if (sub === 'browse') {
      const drugs = getDrugs().filter(d => d.available);
      if (!drugs.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('No drugs on the market right now. Check back later.')
      ], ephemeral:true });

      const phone     = getPhone(userId);
      const hasBurner = phone?.type === 'burner';

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2c3e50)
        .setTitle('💊 Drug Market')
        .setDescription(`${hasBurner ? '🔥 **Burner phone detected** — you can order cross-border.\n\n' : '⚠️ You need a **burner phone** to place orders.\n\n'}${drugs.map(d =>
          `${d.emoji||'💊'} **${d.name}** — $${d.price.toLocaleString()}/unit\n*${d.description||'No description'}*\n📦 Effect: ${d.effect||'none'}`
        ).join('\n\n')}`)
        .setFooter({ text: hasBurner ? 'Use /drugmarket order to place an order' : 'Buy a burner phone from /phoneshop to order' })
      ], ephemeral:true });
    }

    // ── ORDER ────────────────────────────────────────────────
    if (sub === 'order') {
      const phone = getPhone(userId);
      if (!phone || phone.type !== 'burner') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setTitle('📵 Burner Phone Required')
        .setDescription('You need a **burner phone** to order drugs across the border.\n\nBuy one with `/phoneshop`.')
      ], ephemeral:true });

      const drugId = interaction.options.getString('drug');
      const qty    = interaction.options.getInteger('quantity');
      if (drugId === '__none__') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No drugs available right now.')], ephemeral:true });

      const drug = getDrug(drugId);
      if (!drug || !drug.available) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('That drug is not available.')], ephemeral:true });

      // Cooldown
      const lastOrder = orderCooldowns.get(userId) || 0;
      if (Date.now() - lastOrder < ORDER_COOLDOWN) {
        const mins = Math.ceil((ORDER_COOLDOWN - (Date.now()-lastOrder)) / 60000);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Order cooldown: **${mins}m** remaining. The border needs to cool down.`)], ephemeral:true });
      }

      const totalCost = drug.price * qty;
      const user      = getOrCreateUser(userId);
      if (user.wallet < totalCost) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You need **$${totalCost.toLocaleString()}** but only have **$${user.wallet.toLocaleString()}** in your wallet.`)
      ], ephemeral:true });

      // Delivery delay (2-5 min) + bust chance
      const deliveryMs  = (2 + Math.floor(Math.random() * 4)) * 60 * 1000;
      const deliveryMin = Math.round(deliveryMs / 60000);
      const busted      = Math.random() < BUST_CHANCE;

      // Deduct cost
      user.wallet -= totalCost;
      saveUser(userId, user);
      orderCooldowns.set(userId, Date.now());

      await interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2c3e50)
        .setTitle('📦 Order Placed — In Transit')
        .setDescription(`**${qty}× ${drug.emoji||'💊'} ${drug.name}** ordered cross-border.\n\n🚚 Delivery in **${deliveryMin} minutes**.\n💵 Cost: **$${totalCost.toLocaleString()}** deducted.\n\n⚠️ There's a chance your package gets intercepted at the border.`)
        .setFooter({ text:'Burner phone keeps your identity hidden' })
      ], ephemeral:true });

      // Schedule delivery
      setTimeout(async () => {
        try {
          const discordUser = await interaction.client.users.fetch(userId);
          if (busted) {
            // Busted — add heat + possible jail
            const { addHeat, checkPoliceRaid } = require('../../utils/gangDb');
            await addHeat(userId, 25, 'drug smuggling bust');

            const { getConfig } = require('../../utils/db');
            const config = getConfig(interaction.guild.id);
            if (config.prisonRoleId && config.prisonChannelId) {
              const { jailUser } = require('../moderation/jail');
              const jailMins = 5 + Math.floor(Math.random() * 10);
              await jailUser(interaction.guild, userId, jailMins, 'Drug smuggling — caught at border', config, null);
            }

            await discordUser.send({ embeds:[new EmbedBuilder()
              .setColor(0xff3b3b)
              .setTitle('🚔 Package Intercepted!')
              .setDescription(`Your **${qty}× ${drug.name}** shipment was seized at the border.\n\nYou've been flagged for drug smuggling. Heat +25.\n\n*Your $${totalCost.toLocaleString()} was lost.*`)
            ]}).catch(()=>{});
          } else {
            // Delivered — add drug items to inventory
            const { getOrCreateUser: gocU, saveUser: sU, getStore } = require('../../utils/db');
            const recipient = gocU(userId);
            const store = getStore(interaction.guildId);

            // Find matching store item (isDrug flag + name match)
            const storeItem = store.items.find(i => i.isDrug && (
              i.name.toLowerCase().includes(drug.name.toLowerCase()) ||
              i.id === drug.storeItemId
            ));

            if (storeItem) {
              recipient.inventory = [...(recipient.inventory||[])];
              for (let i = 0; i < qty; i++) recipient.inventory.push(storeItem.id);
              sU(userId, recipient);
            }

            await discordUser.send({ embeds:[new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle('📦 Package Delivered!')
              .setDescription(`**${qty}× ${drug.emoji||'💊'} ${drug.name}** arrived safely.\n\nCheck your \`/inventory\` to see your stash.${storeItem ? '' : '\n\n⚠️ No matching store item found — contact an admin.'}`)
            ]}).catch(()=>{});
          }
        } catch(e) { console.error('Drug delivery error:', e.message); }
      }, deliveryMs);
    }
  },
};
