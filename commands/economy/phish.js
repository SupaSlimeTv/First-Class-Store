// ============================================================
// commands/economy/phish.js
// Send a fake "official" DM to a business owner
// If they reply with their routing number within 2 minutes,
// the phisher intercepts it and gets full laptop access
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, isBotBanned, getStore } = require('../../utils/db');
const { getBusiness, saveBusiness, BIZ_TYPES } = require('../../utils/bizDb');
const { getGangGoons, saveGangGoons, hasAccountant } = require('../../utils/goonDb');
const { getGangByMember } = require('../../utils/gangDb');
const { col } = require('../../utils/mongo');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const PHISH_CD    = 20 * 60 * 1000; // 20 min cooldown per phisher
const phishCooldowns = new Map();

// Fake official message templates
const PHISH_TEMPLATES = [
  {
    title: '⚠️ Business Account Verification Required',
    body:  (guild, bizName) =>
      `Hello,\n\nWe have detected unusual activity on your **${bizName}** account registered with **${guild}**.\n\nTo prevent suspension, please verify your account immediately by replying to this message with your **business routing number**.\n\nThis process is mandatory and must be completed within **2 minutes**.\n\n— First Class Store Security Team`,
    footer: 'security@firstclassstore.io',
  },
  {
    title: '🏦 Mandatory KYC — Business Account',
    body:  (guild, bizName) =>
      `Dear Business Owner,\n\nAs part of our **Know Your Customer (KYC)** compliance update, all businesses on **${guild}** must re-verify their routing credentials.\n\nPlease reply with your **routing number** to complete verification and avoid a temporary account freeze.\n\n*This message was sent automatically by the compliance system.*\n\n— First Class Store Compliance Dept`,
    footer: 'compliance@firstclassstore.io',
  },
  {
    title: '💸 Pending Transfer — Action Required',
    body:  (guild, bizName) =>
      `Hi,\n\nA **revenue payout** of undisclosed amount is pending for your business **${bizName}** on **${guild}**.\n\nTo release the funds, you must confirm your **business routing number** within 2 minutes. Unconfirmed payouts are automatically returned.\n\n— First Class Store Finance`,
    footer: 'finance@firstclassstore.io',
  },
  {
    title: '🔐 Security Alert — Routing Number Confirmation',
    body:  (guild, bizName) =>
      `ALERT: Someone attempted to access your **${bizName}** business account on **${guild}**.\n\nIf this was NOT you, please confirm your identity immediately by replying with your **routing number** so we can lock the account.\n\nFail to respond within 2 minutes and access will be suspended.\n\n— First Class Store Security`,
    footer: 'noreply@firstclassstore.io',
  },
];

// Extra templates only available with a burner phone
// These mimic Discord system messages to be even more convincing
const BURNER_TEMPLATES = [
  {
    title: '🔔 Discord System Message',
    body:  (guild, bizName) =>
      `Hi there,\n\nYour connected application **First Class Store** on **${guild}** has flagged a suspicious login attempt to your linked account **${bizName}**.\n\nTo secure your account, please confirm your verification code. Reply with your **routing number** to verify ownership.\n\nIf you don't verify within 2 minutes, your application access will be revoked.\n\n— Discord Trust & Safety`,
    footer: 'noreply@discord.com',
    disguised: true,
  },
  {
    title: '⚡ First Class Store — Instant Payout Ready',
    body:  (guild, bizName) =>
      `Your business **${bizName}** has a **surprise bonus payout** ready on **${guild}**!\n\nThis is a limited-time reward for active business owners. To claim it, reply with your routing number within **2 minutes**.\n\nThis offer expires automatically.\n\n— FCS Rewards Team`,
    footer: 'rewards@firstclassstore.io',
    disguised: true,
  },
  {
    title: '🏦 Bank Transfer Authorization',
    body:  (guild, bizName) =>
      `A large transfer is pending to your **${bizName}** account.\n\nFor security purposes, we need to verify your identity before releasing funds. Please reply with your **routing number** to authorize the transfer.\n\nNote: Transfers unclaimed within 2 minutes are automatically reversed.\n\n— FCS Banking`,
    footer: 'banking@firstclassstore.io',
    disguised: true,
  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('phish')
    .setDescription('Send a fake verification DM to trick a business owner into revealing their routing number.')
    .addUserOption(o => o.setName('target').setDescription('Business owner to phish').setRequired(true)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;

    if (isBotBanned(interaction.user.id)) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You are silenced.')], ephemeral:true });
    }

    const target = interaction.options.getUser('target');
    const userId = interaction.user.id;

    if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't phish yourself.")], ephemeral:true });
    if (target.bot)           return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't phish bots.")], ephemeral:true });

    // Must own a phishing item (laptop or hacking tool)
    const user  = getOrCreateUser(userId);
    const store = getStore(interaction.guildId);
    const tool  = store.items.find(i =>
      (i.effect?.type === 'laptop' || i.id?.toLowerCase().includes('laptop') || i.name?.toLowerCase().includes('laptop') ||
       i.id?.toLowerCase().includes('hack')  || i.name?.toLowerCase().includes('hack')) &&
      (user.inventory||[]).includes(i.id)
    );
    if (!tool) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setTitle('💻 No Hacking Tool')
      .setDescription('You need a **laptop** or **hacking item** from the shop to phish.\n\nBuy one with `/shop`.')
    ], ephemeral:true });

    // Cooldown
    const lastPhish = phishCooldowns.get(userId) || 0;
    if (Date.now() - lastPhish < PHISH_CD) {
      const mins = Math.ceil((PHISH_CD-(Date.now()-lastPhish))/60000);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Phishing cooldown: **${mins}m** remaining.`)], ephemeral:true });
    }

    // Target must own a business
    const biz = getBusiness(target.id);
    if (!biz) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription(`<@${target.id}> doesn't own a business — nothing to phish.`)
    ], ephemeral:true });

    const bizType = BIZ_TYPES[biz.type] || {};
    phishCooldowns.set(userId, Date.now());

    // Pick random template
    // Burner phone users get extra disguised templates + no sender name leak
    const { getPhone, PHONE_TYPES } = require('../../utils/phoneDb');
    const senderPhone = getPhone(userId);
    const hasBurner   = senderPhone?.type === 'burner';

    const allTemplates = hasBurner ? [...PHISH_TEMPLATES, ...BURNER_TEMPLATES] : PHISH_TEMPLATES;
    const tpl = allTemplates[Math.floor(Math.random() * allTemplates.length)];

    // Send fake DM to target
    let dmSent = false;
    try {
      await target.send({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)  // green = looks official
        .setTitle(tpl.title)
        .setDescription(tpl.body(interaction.guild.name, biz.name))
        .setFooter({ text:tpl.footer })
        .setTimestamp()
      ]});
      dmSent = true;
    } catch {
      phishCooldowns.delete(userId); // refund cooldown if DM fails
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Couldn't DM <@${target.id}> — they may have DMs disabled.`)
      ], ephemeral:true });
    }

    await interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(hasBurner ? 0x2ecc71 : 0xff8800)
      .setTitle(hasBurner ? '🔥 Burner Phish Sent — Disguised' : '🎣 Phishing Message Sent')
      .setDescription(`Fake${hasBurner ? ' highly convincing' : ''} DM sent to <@${target.id}>.

If they reply with their routing number within **2 minutes**, you'll receive it here.

${hasBurner ? '🔥 **Burner phone active** — template appears as an official system message. Your identity is masked.' : '*If they ignore it or reply wrong, nothing happens.*'}`)
    ], ephemeral:true });

    // ── INTERCEPT LISTENER ────────────────────────────────────
    // Wait for a DM reply from the target to the BOT that looks like a routing number
    const TIME_LIMIT = 2 * 60 * 1000; // 2 min window
    const FCS_PATTERN = /FCS-\d{8}/i;

    // Listen in target's DM channel
    const dmChannel = await target.createDM().catch(() => null);
    if (!dmChannel) return;

    const filter = m => m.author.id === target.id && FCS_PATTERN.test(m.content);
    let intercepted;
    try {
      const collected = await dmChannel.awaitMessages({ filter, max:1, time:TIME_LIMIT, errors:['time'] });
      intercepted = collected.first();
    } catch {
      // Target didn't fall for it
      try {
        await interaction.followUp({ embeds:[new EmbedBuilder()
          .setColor(0x888888)
          .setTitle('🎣 Phish Unsuccessful')
          .setDescription(`<@${target.id}> didn't fall for it — no routing number received within 2 minutes.`)
        ], ephemeral:true });
      } catch {}
      return;
    }

    // Got the routing number!
    const routingMatch = intercepted.content.match(FCS_PATTERN);
    const capturedRouting = routingMatch[0].toUpperCase();

    // Verify it's actually valid
    const c       = await col('routingNumbers');
    const rDoc    = await c.findOne({ routing: capturedRouting });
    const ownerId = rDoc?._id;

    if (!ownerId || ownerId !== target.id) {
      // They sent a fake/wrong routing number
      try {
        await interaction.followUp({ embeds:[new EmbedBuilder()
          .setColor(0xff8800)
          .setTitle('🎣 Routing Number Captured — Invalid')
          .setDescription(`<@${target.id}> replied with \`${capturedRouting}\` but it didn't match their business.`)
        ], ephemeral:true });
      } catch {}
      return;
    }

    // ── CONFIRMED — send routing to phisher ───────────────────
    // Delete the victim's DM to make it harder to detect (best effort)
    await intercepted.delete().catch(()=>{});

    // Get full account details
    const targetBiz    = getBusiness(target.id);
    const targetBizType= BIZ_TYPES[targetBiz?.type||''] || {};
    const targetGang   = getGangByMember(target.id);
    let dirtyMoney = 0;
    if (targetGang) {
      const gd = getGangGoons(targetGang.id);
      dirtyMoney = gd.dirtyMoney || 0;
    }

    try {
      // Also steal SSN fragment on phish success
      const { getOrCreateCredit, saveCredit: _sc } = require('../../utils/creditDb');
      const vc = await getOrCreateCredit(target.id);
      const hc = await getOrCreateCredit(userId);
      if (!hc.ssnStolen) hc.ssnStolen = {};
      // Phishing only gets first segment — need /hack ssn for the full number
      const [seg1] = vc.ssn.split('-');
      hc.ssnStolen[target.id] = hc.ssnStolen[target.id] || { ssn:`${seg1}-XX-XXXX`, partial:true, score:vc.score, at:Date.now() };
      await _sc(userId, hc);
    } catch {}

    try {
      await interaction.followUp({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🎣 Phish Successful! Routing Number Captured!')
        .setDescription(`<@${target.id}> fell for it and sent their routing number!`)
        .addFields(
          { name:'🔑 Routing Number',  value:`\`${capturedRouting}\``,                  inline:false },
          { name:`${targetBizType.emoji||'🏢'} Business`, value:targetBiz?.name||'Unknown', inline:true },
          { name:'✅ Clean Revenue',   value:`$${(targetBiz?.revenue||0).toLocaleString()}`, inline:true },
          { name:'💊 Dirty Money',     value:`$${dirtyMoney.toLocaleString()}`,           inline:true },
          { name:'🪪 SSN Fragment',    value:`\`${(await (async()=>{const {getOrCreateCredit}=require('../../utils/creditDb');const c=await getOrCreateCredit(target.id);const [s]=c.ssn.split('-');return `${s}-XX-XXXX`;})())}\` *(partial — use \`/hack ssn\` for full)*`, inline:false },
          { name:'💻 Next Step',       value:'Use `/laptop` with this routing number to access and drain their accounts.', inline:false },
        )
        .setFooter({ text:'Use /laptop routing:' + capturedRouting + ' to access funds' })
      ], ephemeral:true });
    } catch {}

    // Log for audit
    try {
      const audCol = await col('auditLog');
      await audCol.insertOne({ guildId: interaction.guild.id, userId, action:'phish_success', data:{ target:target.id, routing:capturedRouting }, ts:Date.now() });
    } catch {}
  },
};
