// ============================================================
// commands/gangs/ganginventory.js
// Gang shared inventory — drugs, guns, goons
// Accessible to all gang members. Only leader can add/remove.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getStore, removeItem } = require('../../utils/db');
const { getGangByMember, saveGang } = require('../../utils/gangDb');
const { getGunInventory, saveGunInventory, GUN_DATA } = require('../../utils/gunDb');
const { getGangGoons, saveGangGoons, GOON_TYPES } = require('../../utils/goonDb');
const { getDrugs } = require('../../utils/drugDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ganginventory')
    .setDescription('View or manage your gang\'s shared inventory.')
    .addSubcommand(s => s.setName('view').setDescription('View the gang inventory'))
    .addSubcommand(s => s.setName('deposit').setDescription('Add something to the gang inventory')
      .addStringOption(o => o.setName('type').setDescription('What to deposit').setRequired(true)
        .addChoices(
          { name:'🎒 Store Item (including drugs)', value:'item' },
          { name:'🔫 Gun',                          value:'gun'  },
        ))
      .addStringOption(o => o.setName('id').setDescription('Item or gun ID').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('withdraw').setDescription('Take something from the gang inventory')
      .addStringOption(o => o.setName('type').setDescription('What to withdraw').setRequired(true)
        .addChoices(
          { name:'🎒 Store Item (including drugs)', value:'item' },
          { name:'🔫 Gun',                          value:'gun'  },
        ))
      .addStringOption(o => o.setName('id').setDescription('Item or gun ID').setRequired(true).setAutocomplete(true))),

  async autocomplete(interaction) {
    const sub    = interaction.options.getSubcommand();
    const type   = interaction.options.getString('type');
    const focused = interaction.options.getFocused().toLowerCase();
    const userId = interaction.user.id;
    const gang   = getGangByMember(userId);

    if (sub === 'deposit') {
      if (type === 'item') {
        const user  = getOrCreateUser(userId);
        const store = getStore();
        const inv   = user.inventory || [];
        const counts= inv.reduce((a,id)=>{ a[id]=(a[id]||0)+1; return a; }, {});
        const choices = Object.entries(counts).map(([id,cnt]) => {
          const item = store.items.find(i=>i.id===id);
          return { name:`${item?.name||id}${cnt>1?` ×${cnt}`:''}${item?.isDrug?' 💊':''}`, value:id };
        }).filter(c=>c.name.toLowerCase().includes(focused)).slice(0,25);
        return interaction.respond(choices.length ? choices : [{ name:'Nothing to deposit', value:'__none__' }]);
      }
      if (type === 'gun') {
        const inv = getGunInventory(userId);
        const choices = inv.map(g => ({
          name:`${GUN_DATA?.[g.gunId]?.name||g.gunId} (HP:${g.hp||100})`, value:g.gunId
        })).filter(c=>c.name.toLowerCase().includes(focused)).slice(0,25);
        return interaction.respond(choices.length ? choices : [{ name:'No guns', value:'__none__' }]);
      }
    }

    if (sub === 'withdraw' && gang) {
      const inv = gang.inventory || { items:{}, guns:[] };
      if (type === 'item') {
        const store = getStore();
        const choices = Object.entries(inv.items||{}).map(([id,cnt]) => {
          const item = store.items.find(i=>i.id===id);
          return { name:`${item?.name||id} ×${cnt}`, value:id };
        }).filter(c=>c.name.toLowerCase().includes(focused)).slice(0,25);
        return interaction.respond(choices.length ? choices : [{ name:'Inventory empty', value:'__none__' }]);
      }
      if (type === 'gun') {
        const choices = (inv.guns||[]).map(g => ({
          name:`${GUN_DATA?.[g.gunId]?.name||g.gunId}`, value:g.gunId
        })).filter(c=>c.name.toLowerCase().includes(focused)).slice(0,25);
        return interaction.respond(choices.length ? choices : [{ name:'No guns', value:'__none__' }]);
      }
    }
    return interaction.respond([]);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const gang   = getGangByMember(userId);
    if (!gang) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You're not in a gang.")], ephemeral:true });

    const inv = gang.inventory || { items:{}, guns:[] };

    // ── VIEW ─────────────────────────────────────────────────
    if (sub === 'view') {
      const store    = getStore();
      const goonData = getGangGoons(gang.id);
      const drugs    = getDrugs();

      const itemLines = Object.entries(inv.items||{}).map(([id,cnt]) => {
        const item  = store.items.find(i=>i.id===id);
        const isDrug= item?.isDrug;
        return `${isDrug?'💊':'🎒'} **${item?.name||id}** ×${cnt}`;
      });

      const gunLines = (inv.guns||[]).map(g => {
        const gd = GUN_DATA?.[g.gunId];
        return `🔫 **${gd?.name||g.gunId}** (HP:${g.hp||100}) ${g.ammo||0} rounds`;
      });

      const goonLines = (goonData.goons||[]).map(g => {
        const gt = GOON_TYPES[g.type];
        return `${gt?.emoji||'👊'} **${gt?.name||g.type}** ×${g.count}`;
      });

      const isEmpty = !itemLines.length && !gunLines.length && !goonLines.length;

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle(`${gang.color||'🏴'} ${gang.name} — Gang Inventory`)
        .setDescription(isEmpty ? '*Empty. Leader can deposit items and guns with `/ganginventory deposit`.*' : null)
        .addFields(
          ...(itemLines.length ? [{ name:'💊 Items & Drugs', value:itemLines.join('\n'), inline:false }] : []),
          ...(gunLines.length  ? [{ name:'🔫 Weapons',       value:gunLines.join('\n'),  inline:false }] : []),
          ...(goonLines.length ? [{ name:'👊 Goons',          value:goonLines.join('\n'), inline:false }] : []),
          { name:'💰 Gang Bank', value:fmtMoney(gang.bank||0), inline:true },
          { name:'🏴 Members',   value:(gang.members||[]).length.toString(), inline:true },
        )
        .setFooter({ text:'Use /ganginventory withdraw to take items. Leader only can deposit.' })
      ]});
    }

    // ── DEPOSIT (leader only) ─────────────────────────────────
    if (sub === 'deposit') {
      if (gang.leaderId !== userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Only the gang leader can deposit items.")], ephemeral:true });

      const type = interaction.options.getString('type');
      const id   = interaction.options.getString('id');
      if (id === '__none__') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Nothing to deposit.")], ephemeral:true });

      if (type === 'item') {
        const user = getOrCreateUser(userId);
        if (!(user.inventory||[]).includes(id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't own \`${id}\`.`)], ephemeral:true });
        removeItem(userId, id);
        inv.items = inv.items || {};
        inv.items[id] = (inv.items[id]||0) + 1;
        gang.inventory = inv;
        await saveGang(gang.id, gang);
        const store = getStore();
        const item  = store.items.find(i=>i.id===id);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setDescription(`${item?.isDrug?'💊':'🎒'} **${item?.name||id}** deposited into the gang inventory.`)
        ]});
      }

      if (type === 'gun') {
        const gunInv = getGunInventory(userId);
        const idx    = gunInv.findIndex(g=>g.gunId===id);
        if (idx===-1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You don't own gun \`${id}\`.`)], ephemeral:true });
        const [gun] = gunInv.splice(idx, 1);
        await saveGunInventory(userId, gunInv);
        inv.guns = [...(inv.guns||[]), gun];
        gang.inventory = inv;
        await saveGang(gang.id, gang);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setDescription(`🔫 **${GUN_DATA?.[id]?.name||id}** deposited into the gang inventory.`)
        ]});
      }
    }

    // ── WITHDRAW (any member) ─────────────────────────────────
    if (sub === 'withdraw') {
      const type = interaction.options.getString('type');
      const id   = interaction.options.getString('id');
      if (id === '__none__') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Nothing to withdraw.")], ephemeral:true });

      if (type === 'item') {
        if (!(inv.items||{})[id]) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`\`${id}\` not in gang inventory.`)], ephemeral:true });
        inv.items[id]--;
        if (inv.items[id] <= 0) delete inv.items[id];
        gang.inventory = inv;
        await saveGang(gang.id, gang);
        const user  = getOrCreateUser(userId);
        user.inventory = [...(user.inventory||[]), id];
        saveUser(userId, user);
        const store = getStore();
        const item  = store.items.find(i=>i.id===id);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setDescription(`${item?.isDrug?'💊':'🎒'} **${item?.name||id}** taken from gang inventory.`)
        ], ephemeral:true });
      }

      if (type === 'gun') {
        const idx = (inv.guns||[]).findIndex(g=>g.gunId===id);
        if (idx===-1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Gun \`${id}\` not in gang inventory.`)], ephemeral:true });
        const [gun] = inv.guns.splice(idx, 1);
        gang.inventory = inv;
        await saveGang(gang.id, gang);
        const gunInv = getGunInventory(userId);
        gunInv.push(gun);
        await saveGunInventory(userId, gunInv);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setDescription(`🔫 **${GUN_DATA?.[id]?.name||id}** taken from gang inventory.`)
        ], ephemeral:true });
      }
    }
  },
};
