const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser, isBotBanned, getStore, getConfig } = require('../../utils/db');
const { getBusiness, saveBusiness, BIZ_TYPES } = require('../../utils/bizDb');
const { getGangGoons, saveGangGoons, hasAccountant } = require('../../utils/goonDb');
const { getGangByMember } = require('../../utils/gangDb');
const { getBtcWallet, saveBtcWallet } = require('../../utils/bitcoinDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const { getUserByRouting } = require('../../utils/routingDb');
const { col } = require('../../utils/mongo');

const ALERT_THRESHOLD = 5000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('laptop')
    .setDescription('Access a business account using a routing number.')
    .addStringOption(o => o.setName('routing').setDescription('Business routing number (FCS-XXXXXXXX)').setRequired(true))
    .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true)
      .addChoices(
        { name:'📊 Check Balances — read only',               value:'check'    },
        { name:'💸 Launder Dirty → Clean Money',              value:'launder'  },
        { name:'💵 Withdraw Clean Revenue → Hot Wallet',      value:'withdraw' },
      ))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount (leave blank for all)').setRequired(false).setMinValue(1)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    if (isBotBanned(interaction.user.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You are silenced.')], ephemeral:true });

    const routingNum = interaction.options.getString('routing').trim().toUpperCase();
    const action     = interaction.options.getString('action');
    const amount     = interaction.options.getInteger('amount');
    const userId     = interaction.user.id;

    // Must own a laptop item
    const user   = getOrCreateUser(userId);
    const store  = getStore();
    const laptop = store.items.find(i =>
      (i.effect?.type === 'laptop' || (i.id||'').toLowerCase().includes('laptop') || (i.name||'').toLowerCase().includes('laptop')) &&
      (user.inventory||[]).includes(i.id)
    );
    if (!laptop) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setTitle('💻 No Laptop')
      .setDescription('You need a **laptop** item from the shop.\n\nBuy one with `/shop`.')
    ], ephemeral:true });

    // Lookup routing number
    const ownerId = await getUserByRouting(routingNum);
    if (!ownerId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription(`Routing number \`${routingNum}\` not found.`)
    ], ephemeral:true });

    const biz     = getBusiness(ownerId);
    if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription('That routing number no longer has an active business.')
    ], ephemeral:true });

    const bizType      = BIZ_TYPES[biz.type] || {};
    const ownerGang    = getGangByMember(ownerId);
    let goonData       = null;
    let dirtyMoney     = 0;
    if (ownerGang) { goonData = getGangGoons(ownerGang.id); dirtyMoney = goonData.dirtyMoney || 0; }
    const cleanRevenue = biz.revenue || 0;
    const isOwner      = ownerId === userId;

    // ── CHECK ─────────────────────────────────────────────────
    if (action === 'check') {
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x00d2ff)
        .setTitle('💻 Account Connected — Read Only')
        .setDescription(`**${bizType.emoji||'🏢'} ${biz.name}**${isOwner?' *(your account)*':''}`)
        .addFields(
          { name:'✅ Clean Revenue', value:`$${cleanRevenue.toLocaleString()}`, inline:true },
          { name:'💊 Dirty Money',   value:`$${dirtyMoney.toLocaleString()}`,   inline:true },
          { name:'💎 Total',         value:`$${(cleanRevenue+dirtyMoney).toLocaleString()}`, inline:true },
        )
      ], ephemeral:true });
    }

    await interaction.deferReply();

    const available = action === 'launder' ? dirtyMoney : cleanRevenue;
    if (available < 1) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription(action === 'launder' ? 'No dirty money available.' : 'No clean revenue available.')
    ]});

    const transferAmt = Math.min(amount || available, available);

    // ── LAUNDER ───────────────────────────────────────────────
    if (action === 'launder') {
      const hasAcct = goonData ? hasAccountant(goonData.goons||[]) : false;
      const baseFee = bizType.isCashBusiness ? 0.20 : 0.35;
      const fee     = hasAcct ? baseFee * 0.40 : baseFee;
      const clean   = Math.floor(transferAmt * (1 - fee));

      if (goonData) { goonData.dirtyMoney = Math.max(0, dirtyMoney - transferAmt); await saveGangGoons(ownerGang.id, goonData); }
      biz.revenue = (biz.revenue||0) + clean;
      await saveBusiness(ownerId, biz);

      // Hot funds go to hacker's BTC wallet
      const btc = getBtcWallet(userId);
      btc.hotFunds = (btc.hotFunds||0) + clean;
      await saveBtcWallet(userId, btc);

      if (!isOwner) await notifyOwner(interaction, ownerId, biz.name, 'launder', clean, transferAmt);

      return interaction.editReply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71).setTitle('✅ Launder Complete')
        .setDescription(`⚠️ Funds are **HOT** — use \`/bitcoin mix\` before spending.`)
        .addFields(
          { name:'💊 Dirty In',  value:`$${transferAmt.toLocaleString()}`, inline:true },
          { name:'🔥 Hot Out',   value:`$${clean.toLocaleString()}`,        inline:true },
          { name:'✂️ Fee',      value:`${Math.round(fee*100)}%`,           inline:true },
        )
      ]});
    }

    // ── WITHDRAW ──────────────────────────────────────────────
    if (action === 'withdraw') {
      biz.revenue = Math.max(0, cleanRevenue - transferAmt);
      await saveBusiness(ownerId, biz);

      // Hot funds
      const btc = getBtcWallet(userId);
      btc.hotFunds = (btc.hotFunds||0) + transferAmt;
      await saveBtcWallet(userId, btc);

      if (!isOwner) await notifyOwner(interaction, ownerId, biz.name, 'withdraw', transferAmt, transferAmt);

      return interaction.editReply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71).setTitle('✅ Withdrawal Complete')
        .setDescription(`⚠️ Funds are **HOT** — use \`/bitcoin mix\` before spending.`)
        .addFields(
          { name:'🔥 Hot Funds',    value:`$${transferAmt.toLocaleString()}`,  inline:true },
          { name:'🏢 Rev Left',     value:`$${biz.revenue.toLocaleString()}`,  inline:true },
        )
      ]});
    }
  },
};

async function notifyOwner(interaction, ownerId, bizName, type, amount, gross) {
  try {
    const ownerDiscord = await interaction.client.users.fetch(ownerId);
    const isLarge = amount >= ALERT_THRESHOLD;
    const embed = new EmbedBuilder()
      .setColor(isLarge ? 0xff3b3b : 0xf5c518)
      .setTitle(isLarge ? '🚨 Large Account Access Detected!' : '💻 Account Access Alert')
      .setDescription(type === 'withdraw'
        ? `**$${amount.toLocaleString()}** was withdrawn from **${bizName}** by an unknown party.`
        : `**$${gross.toLocaleString()}** laundered through **${bizName}**. +$${amount.toLocaleString()} to clean revenue.`)
      .addFields(
        { name:'🕵️ Identity', value:'Unknown — routing number used.', inline:true },
        { name:'💰 Amount',   value:`$${amount.toLocaleString()}`,     inline:true },
        ...(isLarge ? [{ name:'🚨 Report?', value:'Press the button below to alert police. They will trace the funds.', inline:false }] : [])
      )
      .setFooter({ text:'Tip: Never share your routing number in DMs — that is phishing.' })
      .setTimestamp();

    if (isLarge) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`police_report_${ownerId}_${Date.now()}`).setLabel('🚔 Report to Police').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ignore_${ownerId}`).setLabel('Ignore').setStyle(ButtonStyle.Secondary),
      );
      const dm = await ownerDiscord.send({ embeds:[embed], components:[row] });
      const collector = dm.createMessageComponentCollector({ time: 5*60*1000 });
      collector.on('collect', async btn => {
        if (btn.customId.startsWith('police_report_')) {
          try {
            const c = await col('policeInvestigations');
            await c.insertOne({ reportedBy:ownerId, bizName, amount, type, ts:Date.now(), status:'open', traceLevel:0 });
          } catch {}
          await btn.update({ embeds:[new EmbedBuilder().setColor(0xff8800).setTitle('🚔 Report Filed')
            .setDescription(`Police investigation opened for **$${amount.toLocaleString()}** taken from **${bizName}**.\n\nDetectives will trace any BTC mixing activity. The suspect doesn't know they're being watched.`)
          ], components:[] });
        } else {
          await btn.update({ components:[] });
        }
        collector.stop();
      });
      collector.on('end', () => dm.edit({ components:[] }).catch(()=>{}));
    } else {
      await ownerDiscord.send({ embeds:[embed] });
    }
  } catch {}
}
