// ============================================================
// commands/fun/admininfo.js — /admininfo
// Admin-only guide to all dashboard and admin features
// ============================================================

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getConfig } = require('../../utils/db');
const { COLORS } = require('../../utils/embeds');

const PAGES = [
  {
    title: '🎛️ Admin Guide — Overview (1/10)',
    color: 0xff3b3b,
    desc: `Welcome to the **First Class Store** admin guide. This embed covers everything you can configure and control as an admin or server owner.\n\nAccess your dashboard at your Railway URL → log in with Discord → select your server.\n\n**Quick access commands you can use right now:**\n\`/createitem\` — create store items without opening the dashboard\n\`/moneydrop\` — manually trigger a money drop\n\`/jail @user\` — jail someone immediately\n\`/ban @user\` — ban a user\n\`/setmodrole @role\` — set a moderator role`,
  },
  {
    title: '🏪 Item Store (2/10)',
    color: 0x5865f2,
    desc: `**Dashboard → Item Store**\n\nCreate items with full control over:\n— **Type**: Buyable (owned), Useable (triggers effect), Role Reward (gives role on buy)\n— **Effect**: drain wallet, drain all funds, silence, hitman, give/remove role, passive income, shield, EMP, gamble, AI entity, minigame hack, magic spell\n— **Role on Purchase**: automatically give a Discord role when bought\n— **Role on Use**: use \`Edit Roles\` effect to give/remove a role when item is used\n— **Requirements**: lock items behind specific roles or other items\n— **Reusable**: single-use vs unlimited\n\nUse \`/createitem\` to create items directly in Discord — supports role selection via dropdown, effect type, price, and description.\n\n**Per-guild** — each server has its own store. Items from other servers are not visible here.`,
  },
  {
    title: '💊 Drug Market (3/10)',
    color: 0x9b59b6,
    desc: `**Dashboard → Drug Market**\n\nCreate drugs that users can order via \`/drugmarket order\` using a burner phone.\n\n**Configure per drug:**\n— Name, emoji, price, description\n— Effect type (buffs, nerfs, passive income)\n— Border risk (chance of getting caught/jailed during delivery)\n— Delivery time (2–5 min)\n— Link to a store item (so the drug gives a physical item on delivery)\n— Gang-only toggle\n\n**Narcotics Role** — optionally restrict drug market access to a specific role.\n\n**Per-guild** — each server has its own drug market.`,
  },
  {
    title: '🔴 Purge System (4/10)',
    color: 0xff3b3b,
    desc: `**Dashboard → Purge**\n\nA server-wide chaos event that drains all bank funds to wallets — making everyone vulnerable.\n\n**Setup:**\n1. Set an **Announcement Channel** — bot @everyone here when purge starts/ends\n2. Set custom **Start GIF** and **End GIF** URLs for the announcement embed\n3. Hit **Start Purge** — all members' banks drain instantly\n4. Hit **End Purge** (or the ↺ Reset button if it gets stuck) to restore\n\n**During purge:**\n— Deposits/withdrawals blocked\n— Rob cooldowns removed\n— All attacks still work\n— Only THIS server's members are affected`,
  },
  {
    title: '🚔 Police System (5/10)',
    color: 0x3498db,
    desc: `**Dashboard → Police**\n\n**Setup:**\n1. Set a **Police Role** — users with this role can use \`/police\` commands\n2. Fund the **Police Treasury** — pays officer salaries automatically\n3. Set officer salaries per-user (💰 button in the Officers table)\n\n**How warrants work:**\n— Auto-issued when a user hits **25+ heat**\n— Officers issue manually with \`/police warrant @user reason:\`\n— Tips from \`/police tip @user\` ($500 fee) — valid tips earn 2× back\n— Warrants expire in **2 hours**\n\n**Officer rules:**\n— Can't search the same person twice in 30min\n— Gang leaders require a warrant to search\n— False searches cost credibility\n— Bribes accepted = credibility loss + logged in audit\n— \`/police raid\` requires **3+ officers** — jails entire gang`,
  },
  {
    title: '🏠 Home System (6/10)',
    color: 0xf5c518,
    desc: `**Dashboard → Police → Home Prices**\n\n**Set custom prices** per tier (Studio/House/Mansion/Estate). Leave blank for defaults.\n\n**Home tiers & defaults:**\n🏚️ Studio — $5k · 3 stash slots · 2 furnishing slots · $50/hr\n🏠 House — $25k · 8 stash · 5 furn · $150/hr\n🏡 Mansion — $100k · 20 stash · 10 furn · $400/hr\n🏰 Estate — $500k · 50 stash · 20 furn · $1,200/hr\n\n**Limits:**\n— Regular users: 1 home max\n— Gang leaders & business owners: 2 homes max\n\n**Furnishings:** Safe (+stash), Security Camera (search alert DM), Drug Lab (+dirty money), Mining Rig (+passive), Panic Room (one arrest escape), Grow House (+dirty), Vault (+stash)`,
  },
  {
    title: '💰 Money Drops (7/10)',
    color: 0x2ecc71,
    desc: `**Dashboard → Overview → Money Drop System**\n\n**Setup:**\n1. Select a **Drop Channel**\n2. Set **Min/Max interval** (e.g. 15–45 min)\n3. Toggle the drop system **ON**\n\n**Drop tiers:**\n⚪ Common — $50–$500 (70%)\n🔵 Uncommon — $500–$5k (20%)\n🟡 Rare — $5k–$50k (7%)\n🔴 Epic — $50k–$485k (3%)\n\nDrops are **per-guild** — Server A's drops never appear in Server B.\nFirst user to click the button wins. Drop expires in 60 seconds.\n\n**Manual drops:** Use \`/moneydrop\` to trigger one instantly with a custom amount and channel.`,
  },
  {
    title: '📢 Embed Builder (8/10)',
    color: 0x00d2ff,
    desc: `**Dashboard → Embeds**\n\n**Step 1** — Select a channel\n**Step 2** — Build your embed (color, title, description, fields, footer, thumbnail, image)\n**Step 3** — Set a plain **Message** above the embed (supports @mentions)\n\n**Event Triggers** — click the ⚡ blue card to link an embed to a server event:\n— 👋 Member Joins\n— 🚪 Member Leaves\n— 🔨 Member Banned\n— ✅ Member Unbanned\n\n**Variables in title/description:**\n\`{user}\` → @mention · \`{username}\` → display name\n\`{server}\` → server name · \`{membercount}\` → member count\n\nSaved triggers appear in the **Active Event Triggers** list below the card — edit or delete any time.`,
  },
  {
    title: '🏦 Economy Config (9/10)',
    color: 0xf5c518,
    desc: `**Dashboard → Overview**\n\n**Command Prefix** — set the \`!\` prefix for legacy text commands\n**Rob Cooldown** — how many minutes between /rob attempts\n**Shot Timeout** — cooldown on /shoot command\n**Mod Commands Role** — role that can use mod commands without full admin\n**Restricted Role** — role blocked from using attack items\n**Protected Roles** — roles that cannot be robbed or attacked\n\n**Lottery** — configure ticket price and draw interval in Dashboard → Overview\n\n**Role Income** — assign passive income to Discord roles (Dashboard → Overview → Role Income)\n\n**Economy is global** — wallets/bank/inventory follow users across servers. Store, drugs, config are per-server.`,
  },
  {
    title: '🛠️ Other Admin Commands (10/10)',
    color: 0xff6b35,
    desc: `**Moderation:**\n\`/ban @user reason:\` — ban\n\`/kick @user reason:\` — kick\n\`/mute @user minutes:\` — timeout\n\`/warn @user reason:\` — warn\n\`/jail @user minutes:\` — jail (requires prison setup)\n\`/unjail @user\` — release from jail\n\`/jailcreate\` — create prison channel + role automatically\n\`/solitary @user\` — move to solitary\n\`/setmodrole @role\` — set mod role\n\`/purge count:\` — bulk delete messages\n\`/overview\` — economy stats summary\n\n**Economy:**\n\`/createitem\` — create store items\n\`/moneydrop amount: channel:\` — manual cash drop\n\`/give @user item:\` — give user an item\n\`/wantedlevel @user\` — view heat record\n\n**Dashboard:** Access at your Railway URL. All sensitive config lives there.`,
  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admininfo')
    .setDescription('Admin guide — everything you can do as an admin or owner (only visible to you)'),

  async execute(interaction) {
    const isAdmin = interaction.member.permissions.has('Administrator') || interaction.member.permissions.has('ManageGuild');
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    if (!isAdmin && !isOwner) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('🚫 This command is for admins and server owners only.')
      ], ephemeral:true });
    }

    let page = 0;

    const buildEmbed = (p) => new EmbedBuilder()
      .setColor(PAGES[p].color)
      .setTitle(PAGES[p].title)
      .setDescription(PAGES[p].desc)
      .setFooter({ text:`Use ◀ ▶ to navigate · Only visible to you` });

    const buildRow = (p) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ai_prev_${p}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p===0),
      new ButtonBuilder().setCustomId(`ai_page_${p}`).setLabel(`${p+1} / ${PAGES.length}`).setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId(`ai_next_${p}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p>=PAGES.length-1),
    );

    await interaction.reply({ embeds:[buildEmbed(page)], components:[buildRow(page)], ephemeral:true });

    const msg       = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time:300_000 });

    collector.on('collect', async btn => {
      if (btn.customId.startsWith('ai_prev')) page = Math.max(0, page-1);
      if (btn.customId.startsWith('ai_next')) page = Math.min(PAGES.length-1, page+1);
      await btn.update({ embeds:[buildEmbed(page)], components:[buildRow(page)] });
    });

    collector.on('end', () => interaction.editReply({ components:[] }).catch(()=>{}));
  },
};
