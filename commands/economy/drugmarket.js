// ============================================================
// commands/economy/drugmarket.js — /drugmarket
// Gang-members-only drug market. Trafficking brings drugs
// cross-border; dealing distributes within the gang.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, isBotBanned } = require('../../utils/db');
const { getGangByMember } = require('../../utils/gangDb');
const { getDrugs, getDrug } = require('../../utils/drugDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const ORDER_COOLDOWN = 45 * 60 * 1000; // 45 min between trafficking runs
const BUST_CHANCE    = 0.15;
const orderCooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('drugmarket')
    .setDescription('Gang-only drug market. Traffic, browse, and deal within your crew.')
    .addSubcommand(s => s.setName('browse')
      .setDescription('View available drugs and street prices'))
    .addSubcommand(s => s.setName('traffic')
      .setDescription('Order drugs cross-border (gang members only, 45-min cooldown)')
      .addStringOption(o => o.setName('drug').setDescription('Drug to traffic').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('quantity').setDescription('Units to order (1–10)').setRequired(true).setMinValue(1).setMaxValue(10)))
    .addSubcommand(s => s.setName('deal')
      .setDescription('Deal drugs to a fellow gang member from your stash')
      .addUserOption(o => o.setName('member').setDescription('Gang member to deal to').setRequired(true))
      .addStringOption(o => o.setName('drug').setDescription('Drug to deal').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('quantity').setDescription('How many units').setRequired(true).setMinValue(1))),

  async autocomplete(interaction) {
    const drugs   = getDrugs().filter(d => d.available);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = drugs
      .map(d => ({ name:`${d.emoji||'💊'} ${d.name} — $${d.price.toLocaleString()}/unit`, value:d.id }))
      .filter(c => c.name.toLowerCase().includes(focused))
      .slice(0, 25);
    return interaction.respond(choices.length ? choices : [{ name:'No drugs available', value:'__none__' }]);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    if (isBotBanned(interaction.user.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You are silenced.')], ephemeral:true });

    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const gang   = getGangByMember(userId);

    // ── BROWSE — open to all, but warns non-gang ─────────────
    if (sub === 'browse') {
      const drugs = getDrugs().filter(d => d.available);
      if (!drugs.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('No drugs on the market right now.')
      ], ephemeral:true });

      const gangWarning = gang ? '' : '⚠️ **You need to be in a gang to traffic or deal drugs.**\n\n';

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2c3e50)
        .setTitle('💊 Drug Market')
        .setDescription(`${gangWarning}${drugs.map(d =>
          `${d.emoji||'💊'} **${d.name}** — **$${d.price.toLocaleString()}/unit**\n*${d.description||'No description'}*`
        ).join('\n\n')}`)
        .setFooter({ text: 'Use /drugmarket traffic to order cross-border · /drugmarket deal to distribute to gang members' })
      ], ephemeral:true });
    }

    // ── Gang check for traffic + deal ────────────────────────
    if (!gang) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setTitle('🚫 Gang Required')
      .setDescription('You need to be in a **gang** to traffic or deal drugs.\n\nJoin or start a gang first.')
    ], ephemeral:true });

    // ── TRAFFIC — cross-border order ─────────────────────────
    if (sub === 'traffic') {
      const drugId = interaction.options.getString('drug');
      const qty    = interaction.options.getInteger('quantity');
      if (drugId === '__none__') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No drugs available right now.')], ephemeral:true });

      const drug = getDrug(drugId);
      if (!drug || !drug.available) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('That drug is unavailable.')], ephemeral:true });

      // Cooldown
      const lastOrder = orderCooldowns.get(userId) || 0;
      if (Date.now() - lastOrder < ORDER_COOLDOWN) {
        const mins = Math.ceil((ORDER_COOLDOWN - (Date.now()-lastOrder)) / 60000);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Trafficking cooldown: **${mins}m** left. Lay low.`)], ephemeral:true });
      }

      const totalCost = drug.price * qty;
      const user      = getOrCreateUser(userId);
      if (user.wallet < totalCost) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Need **$${totalCost.toLocaleString()}** — you have **$${user.wallet.toLocaleString()}**.`)
      ], ephemeral:true });

      const deliveryMs  = (2 + Math.floor(Math.random() * 4)) * 60 * 1000;
      const deliveryMin = Math.round(deliveryMs / 60000);
      const busted      = Math.random() < BUST_CHANCE;

      user.wallet -= totalCost;
      saveUser(userId, user);
      orderCooldowns.set(userId, Date.now());

      await interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2c3e50)
        .setTitle('📦 Shipment In Transit')
        .setDescription(`**${qty}× ${drug.emoji||'💊'} ${drug.name}** ordered cross-border.\n\n🚚 Delivery in **${deliveryMin} minutes**\n💵 Cost: **$${totalCost.toLocaleString()}** deducted\n\n⚠️ 15% chance your package gets seized at the border.`)
        .setFooter({ text:'Gang member only — deal to crew with /drugmarket deal' })
      ], ephemeral:true });

      setTimeout(async () => {
        try {
          const discordUser = await interaction.client.users.fetch(userId);
          if (busted) {
            try { const { addHeat } = require('../../utils/gangDb'); await addHeat(userId, 25, 'drug trafficking bust'); } catch {}
            const config = require('../../utils/db').getConfig(interaction.guild?.id);
            if (config?.prisonRoleId && config?.prisonChannelId) {
              try {
                const { jailUser } = require('../moderation/jail');
                await jailUser(interaction.guild, userId, 5 + Math.floor(Math.random()*10), 'Drug trafficking — seized at border', config, null);
              } catch {}
            }
            await discordUser.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b)
              .setTitle('🚔 Shipment Seized!')
              .setDescription(`Your **${qty}× ${drug.name}** was intercepted.\n\n**$${totalCost.toLocaleString()}** lost. Heat +25.`)
            ]}).catch(()=>{});
          } else {
            // Add to personal inventory — use with /drugmarket deal to distribute
            const { getOrCreateUser: gU, saveUser: sU, getStore } = require('../../utils/db');
            const recipient = gU(userId);
            const store = getStore(interaction.guildId);
            const storeItem = store.items.find(i => i.isDrug && (
              i.name.toLowerCase().includes(drug.name.toLowerCase()) ||
              i.id === drug.storeItemId
            ));
            if (storeItem) {
              recipient.inventory = [...(recipient.inventory||[])];
              for (let i = 0; i < qty; i++) recipient.inventory.push(storeItem.id);
              sU(userId, recipient);
            }
            await discordUser.send({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
              .setTitle('📦 Shipment Delivered!')
              .setDescription(`**${qty}× ${drug.emoji||'💊'} ${drug.name}** arrived safely.\n\nCheck \`/inventory\` — use \`/drugmarket deal\` to distribute to your gang.`)
            ]}).catch(()=>{});
          }
        } catch(e) { console.error('Drug delivery error:', e.message); }
      }, deliveryMs);
    }

    // ── DEAL — distribute to gang member ─────────────────────
    if (sub === 'deal') {
      const target = interaction.options.getUser('member');
      const drugId = interaction.options.getString('drug');
      const qty    = interaction.options.getInteger('quantity');

      if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't deal to yourself.")], ephemeral:true });

      // Target must be in the same gang
      const targetGang = getGangByMember(target.id);
      if (!targetGang || targetGang.id !== gang.id) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`<@${target.id}> is not in your gang. Deals are gang-members-only.`)
      ], ephemeral:true });

      const drug = getDrug(drugId);
      if (!drug || !drug.available) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('That drug is unavailable.')], ephemeral:true });

      // Check dealer has the drug items in inventory
      const user  = getOrCreateUser(userId);
      const store = require('../../utils/db').getStore(interaction.guildId);
      const storeItem = store.items.find(i => i.isDrug && (
        i.name.toLowerCase().includes(drug.name.toLowerCase()) ||
        i.id === drug.storeItemId
      ));
      if (!storeItem) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No store item mapped to this drug.')], ephemeral:true });

      const owned = (user.inventory||[]).filter(id => id === storeItem.id).length;
      if (owned < qty) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You only have **${owned}** units of ${drug.name} to deal.`)
      ], ephemeral:true });

      // Transfer from dealer inventory to target inventory
      let removed = 0;
      user.inventory = (user.inventory||[]).filter(id => {
        if (id === storeItem.id && removed < qty) { removed++; return false; }
        return true;
      });
      const recipient = getOrCreateUser(target.id);
      for (let i = 0; i < qty; i++) recipient.inventory.push(storeItem.id);
      saveUser(userId, user);
      saveUser(target.id, recipient);

      try {
        await target.send({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setTitle('💊 Package Received')
          .setDescription(`**${interaction.user.username}** dropped off **${qty}× ${drug.emoji||'💊'} ${drug.name}**.\n\nCheck \`/inventory\` for your stash.`)
        ]});
      } catch {}

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`💊 Deal Done`)
        .setDescription(`Handed **${qty}× ${drug.name}** to <@${target.id}>.`)
      ], ephemeral:true });
    }
  },
};
