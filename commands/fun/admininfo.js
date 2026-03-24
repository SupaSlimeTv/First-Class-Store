// ============================================================
// commands/fun/admininfo.js — /admininfo
// Owner/Admin guide — dashboard, config, management
// ============================================================
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

const PAGES = [
  new EmbedBuilder().setColor(0xff3b3b)
    .setTitle('⚙️ Admin Guide — Overview (1/10)')
    .setDescription('Full control panel for server owners and admins.\n\nAccess the web dashboard at your Railway URL.')
    .addFields(
      { name:'🌐 Dashboard Sections', value:'**Overview** — Prefix, rob cooldown, shot timeout, money drop, home prices\n**Users** — View/edit all members, give/take anything\n**Item Store** — Create items with custom effects\n**Stock Market** — Manage coins\n**Entrepreneur** — Business controls\n**Police** — Officers, warrants, prison config\n**Gangs** — All gangs, upgrades, dirty money\n**Drug Market** — Drug prices\n**Influencers** — Phone status, followers, hype\n**Purge** — Purge + Great Depression controls\n**Embeds** — Custom embed builder\n**Illuminati** — Member roster, vault, operations\n**TOR/Dark Web** — Active listings, bust users\n**Laptops** — Create apps, set success rates', inline:false },
    ).setFooter({ text:'Page 1/10' }),

  new EmbedBuilder().setColor(0xff3b3b)
    .setTitle('🔧 Server Setup (2/10)')
    .addFields(
      { name:'⚙️ Essential Setup', value:'1. `/jailcreate` — Creates Prison role, Solitary role, prison channel\n2. Set roles/channel in Dashboard → Police\n3. `/setmodrole @role` — Set moderator role\n4. Set command prefix in Dashboard → Overview\n5. Set money drop channel in Dashboard → Overview', inline:false },
      { name:'💰 Economy Config (Dashboard → Overview)', value:'• Command prefix (default `!`)\n• Rob cooldown (minutes)\n• Shot timeout (minutes)\n• Money Drop: toggle, channel, amount range\n• Home System: prices per tier\n• Break-In Defense: % per home tier', inline:false },
      { name:'🎬 Announcements', value:'• Purge channel: for purge/depression/money drop announcements\n• Embed builder: send rich embeds to any channel\n• Embed triggers: auto-send embeds on events', inline:false },
    ).setFooter({ text:'Page 2/10' }),

  new EmbedBuilder().setColor(0xff3b3b)
    .setTitle('👥 Managing Users (3/10)')
    .addFields(
      { name:'📊 Dashboard → Users', value:'View all members with wallet/bank\nEdit wallet/bank inline\nGive/Take anything via the modal:', inline:false },
      { name:'🎁 Give/Take Options', value:'🎒 Store Item · 💵 Money · 🪙 Pet Tokens · ⭐ Pet Level\n🔫 Gun · 🏴 Add to Gang · 🏢 Business Money\n📱 Phone Status/Followers/Hype · 🤝 Sponsor Deal\n📣 Shoutout Multiplier · 📊 **Credit Score**\n🔺 **Illuminati Rank** (sets rank for existing members)', inline:false },
      { name:'🛑 Moderation', value:'`/ban @user` · `/kick @user` · `/mute @user`\n`/warn @user` · `/jail @user <minutes>`\n`/solitary @user` · `/unjail @user`', inline:false },
    ).setFooter({ text:'Page 3/10' }),

  new EmbedBuilder().setColor(0xff3b3b)
    .setTitle('📦 Item Store (4/10)')
    .addFields(
      { name:'➕ Creating Items', value:'Dashboard → Item Store → Add Item\nFields: Name, Price, Description, Type, Enabled, Reusable, Emoji', inline:false },
      { name:'⚡ Effect Types', value:'💸 Drain Wallet · 💻 Drain All · 🔇 Silence · 🔫 Hitman\n🎲 Gamble · 💰 Passive Income · 🛡️ Shield\n🖥️ Minigame Drain · ⚡ EMP Device · 💵 Edit Balance\n🎒 Edit Items · 🏅 Edit Roles · 🤖 AI Entity\n🍽️ Consume · 🔮 Magic · 🔧 Break-In Kit\n**💻 Laptop App** — installs a hacking/intel app', inline:false },
      { name:'💻 Laptop App Effect Fields', value:'• **App Type** — choose from 10 built-in app types\n• **Quality Tier 1-5** — each tier adds +5% success rate\nApp types: SSN Scanner, Credit Cracker, Card Drainer,\nBiz Intruder, Keylogger, VPN Shield, Bank Mirror,\nLaunderBot, Stalker App, DarkSearch', inline:false },
    ).setFooter({ text:'Page 4/10' }),

  new EmbedBuilder().setColor(0xff3b3b)
    .setTitle('💳 Laptop App Creator (5/10)')
    .addFields(
      { name:'🔧 Creating Apps (Dashboard → Laptops)', value:'Create up to 7 apps per batch with full control:\n• **App ID** — which built-in app this item unlocks\n• **Quality Tier** — 1-5, affects success rate\n• **Name & Price** — displayed in shop\n• **Description** — shown in /shop\n• **Success Rate Override** — optional custom %', inline:false },
      { name:'📊 App Success Rates (default)', value:'🪪 SSN Scanner: 40% base\n💳 Credit Cracker: 35% base\n💸 Card Drainer: 45% base\n🏢 Biz Intruder: 50% base\n👁️ Stalker App: 60% base\n🔍 DarkSearch: 55% base\n🧺 LaunderBot: 60% base\nVPN Shield: reduces trace risk -60%\nKeylogger: +20% phishing success', inline:false },
    ).setFooter({ text:'Page 5/10' }),

  new EmbedBuilder().setColor(0xff3b3b)
    .setTitle('🔺 Illuminati (6/10)')
    .addFields(
      { name:'👁️ Dashboard → Illuminati', value:'View current membership roster\nSee vault balance and operation history\nSet member ranks via Users → Give/Take → Illuminati Rank\nExpose/reset the Illuminati if needed', inline:false },
      { name:'📜 Player Commands', value:'`/illuminati found` — Found the org ($250k, owner only)\n`/illuminati invite @user` — Elder+ can invite\n`/illuminati operate` — Run operations\n`/illuminati vault` — Contribute/view treasury\n`/illuminati excommunicate` — Exile a member\n`/illuminati expose` — Reveal members (3+ ops needed)', inline:false },
    ).setFooter({ text:'Page 6/10' }),

  new EmbedBuilder().setColor(0xff3b3b)
    .setTitle('💳 Credit System (7/10)')
    .addFields(
      { name:'📊 Dashboard → Credit Scores', value:'View all users credit scores in one table\nFilter by tier · Sort by score\nAdjust scores via Users → Give/Take → Credit Score', inline:false },
      { name:'💳 Player Commands', value:'`/credit check` — Score, SSN (blurred), card info\n`/credit apply` — Get a card (580+ required)\n`/credit spend` — Charge to card\n`/credit pay` — Pay balance\n`/credit freeze` — Block identity theft\n`/credit loan` — Business financing (670+ required)', inline:false },
      { name:'⚠️ Credit Damage Events', value:'• Identity fraud via `/hack` or TOR purchase: -45\n• Card drained: -25 · Loan default: -80\n• Missed payment interest: -12/day\nAdmins can correct scores via give/take', inline:false },
    ).setFooter({ text:'Page 7/10' }),

  new EmbedBuilder().setColor(0xff3b3b)
    .setTitle('🌐 TOR / Dark Web (8/10)')
    .addFields(
      { name:'🌐 Dashboard → TOR', value:'View all active dark web listings\nSee who listed, buyer/seller handles, data type\nBust users who were traced — manual jail option\nClear expired listings', inline:false },
      { name:'⚖️ Trace Rules', value:'• Base trace chance: **30%**\n• VPN Shield app: **-60%** to trace chance\n• Each installed laptop app: **-5%** trace chance\n• Illuminati members: **always untraceable**\n• Being traced on buy: jailed 10 min + heat\n• Being traced on sell: +heat, victim notified', inline:false },
    ).setFooter({ text:'Page 8/10' }),

  new EmbedBuilder().setColor(0xff3b3b)
    .setTitle('📉 Economy Events (9/10)')
    .addFields(
      { name:'🔴 The Purge (Dashboard → Purge)', value:'Drains all bank → wallet instantly\nBlocks deposits/withdrawals\nRemoves rob cooldowns\nEnd when ready — restores everything', inline:false },
      { name:'📉 The Great Depression (Dashboard → Purge, Owner Only)', value:'**IRREVERSIBLE** — wipes all wallet + bank to $0\nAlso wipes business revenues + gang dirty money\nAll assets kept (homes, items, pets, fame)\nOn end: **$200 survival payment** to every member\n`/depression CONFIRM` or `!depression CONFIRM`', inline:false },
      { name:'💰 Money Drop', value:'Auto-drops claimable cash in a channel\nFirst to click wins — antidote-style weighted drops\nConfigure amount, channel, frequency in Dashboard', inline:false },
    ).setFooter({ text:'Page 9/10' }),

  new EmbedBuilder().setColor(0xff3b3b)
    .setTitle('🔑 Owner-Only Commands (10/10)')
    .addFields(
      { name:'👑 Owner Controls', value:'`/depression CONFIRM` — Crash the entire economy\n`/purge` — Start/end the purge event\n`/moneydrop` — Manual money drop\n`/overview` — Server economy stats', inline:false },
      { name:'🌐 Dashboard URL', value:'Your Railway deployment URL\nLogin with Discord → Select server\nAll changes take effect immediately', inline:false },
      { name:'🛠️ Useful Commands', value:'`/admininfo` — This guide\n`/info` — User-facing guide (16 pages)\n`/setmodrole` — Set mod role\n`/jailcreate` — Create prison system', inline:false },
    ).setFooter({ text:'Page 10/10 · Full docs at your dashboard' }),
];

const buildRow = (page, total) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ai_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
  new ButtonBuilder().setCustomId('ai_page').setLabel(`${page+1}/${total}`).setStyle(ButtonStyle.Primary).setDisabled(true),
  new ButtonBuilder().setCustomId('ai_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page === total-1),
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admininfo')
    .setDescription('⚙️ Admin & owner guide — dashboard, setup, configuration'),

  async execute(interaction) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === interaction.guild.ownerId;
    if (!isAdmin) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xe74c3c).setDescription('❌ Admin/Owner only.')], ephemeral:true });

    let page = 0;
    await interaction.reply({ embeds:[PAGES[0]], components:[buildRow(0, PAGES.length)], ephemeral:true });
    const msg  = await interaction.fetchReply();
    const coll = msg.createMessageComponentCollector({ filter:i=>i.user.id===interaction.user.id, time:10*60*1000 });
    coll.on('collect', async i => {
      if (i.customId === 'ai_prev' && page > 0) page--;
      if (i.customId === 'ai_next' && page < PAGES.length-1) page++;
      await i.update({ embeds:[PAGES[page]], components:[buildRow(page, PAGES.length)] });
    });
    coll.on('end', () => interaction.editReply({ components:[] }).catch(()=>{}));
  },
};
