// ============================================================
// commands/economy/laptop.js — /laptop (REWRITTEN)
// Unified laptop: apps determine capabilities, not separate commands
// ============================================================
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');
const { getOrCreateUser, saveUser, isBotBanned, getStore, getConfig } = require('../../utils/db');
const { getBusiness, saveBusiness, BIZ_TYPES }   = require('../../utils/bizDb');
const { getGangGoons, saveGangGoons }             = require('../../utils/goonDb');
const { getGangByMember }                         = require('../../utils/gangDb');
const { getUserByRouting }                        = require('../../utils/routingDb');
const { getLaptop, saveLaptop, hasApp, BUILTIN_APPS, DEVICE_TIERS, DEVICE_ORDER, getEffectiveSuccess } = require('../../utils/laptopDb');
const { getOrCreateCredit, saveCredit, getCreditTier, adjustScore } = require('../../utils/creditDb');
const { noAccount }  = require('../../utils/accountCheck');
const { COLORS }     = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('laptop')
    .setDescription('💻 Your laptop. Install apps to unlock hacking, finance, and intel capabilities.')
    .addSubcommand(s => s.setName('open').setDescription('Open your laptop — view device and installed apps'))
    .addSubcommand(s => s.setName('appstore').setDescription('Browse and install apps from your item inventory'))
    .addSubcommand(s => s.setName('run').setDescription('Run an installed app')
      .addStringOption(o => o.setName('app').setDescription('App to run — autocomplete shows exactly what each app needs').setRequired(true).setAutocomplete(true))
      .addUserOption(o => o.setName('target').setDescription('👤 INTEL/FRAUD/BREAK-IN apps — Stalker, SSN Scanner, Card Drainer, HomeHack, Voter Suppress, Blacksite').setRequired(false))
      .addStringOption(o => o.setName('routing').setDescription('🔢 BIZ/CRACK apps ONLY — routing# for Biz Intruder/Bank Mirror · SSN# for Credit Cracker/Dark Search').setRequired(false))
      .addStringOption(o => o.setName('action').setDescription('⚡ Biz Intruder ONLY — what to do once inside (ignore for all other apps)').setRequired(false)
        .addChoices(
          { name:'📊 Check Balances — see revenue & dirty money', value:'check' },
          { name:'💵 Withdraw Revenue — steal clean revenue', value:'withdraw' },
          { name:'🧺 Launder Dirty Money — clean their dirty cash', value:'launder' },
        ))
      .addIntegerOption(o => o.setName('amount').setDescription('💰 Biz Intruder/LaunderBot ONLY — amount to process (ignore for all other apps)').setRequired(false).setMinValue(1))),

  async autocomplete(interaction) {
    const focused  = interaction.options.getFocused().toLowerCase();
    const userId   = interaction.user.id;
    const laptop   = getLaptop(userId);
    const apps     = laptop?.apps || [];
    const deviceId = laptop?.deviceId || 'builtin';

    if (!apps.length) {
      return interaction.respond([{ name:'No apps installed — use /laptop appstore first', value:'__none__' }]).catch(()=>null);
    }

    const NEEDS = {
      ssn_scanner:      '① FRAUD step 1 — target:@user → steals SSN (DM\'d to you privately)',
      credit_cracker:   '② FRAUD step 2 — routing:<SSN number from Keylogger> → opens fraud card',
      card_drainer:     '③ FRAUD step 3 — target:@user → drains the card opened in step 2',
      stalker_app:      'INTEL — target:@user → full profile: wallet/bank/home/gang/credit/routing#',
      keylogger:        'INTEL — NO inputs → shows your stolen-SSN vault with actual SSN numbers',
      dark_search:      'INTEL — routing:<SSN or routing#> → search TOR market listings',
      biz_intrude:      'BIZ HACK — routing:<number> action:check/withdraw/launder',
      bank_mirror:      'BIZ HACK — routing:<number> → read-only view of balances',
      home_hack:        'BREAK-IN — target:@user → disable security 30min, then use break-in-kit',
      vpn_shield:       'PASSIVE — reduces TOR trace risk',
      launder_bot:      'PASSIVE — better launder rate for gang dirty money',
      tor_browser:      'PASSIVE — TOR guide + trace risk reduction',
      policy_intel:     'POLITICAL — NO inputs → classified server economy overview',
      voter_suppress:   'POLITICAL — target:@user → block daily/work income 24h (no trace)',
      blacksite_op:     'POLITICAL — target:@user → steal 12% wallet, zero evidence',
      classified_brief: 'POLITICAL — target:@user → full intel + effects + Illuminati standing',
    };

    const deviceLevel = DEVICE_ORDER.indexOf(deviceId);
    const choices = apps.map(a => {
      const def      = BUILTIN_APPS[a.id] || {};
      const required = def.requiresDevice;
      const reqLevel = required ? DEVICE_ORDER.indexOf(required) : 0;
      const locked   = reqLevel > deviceLevel;
      const pct      = a.successOverride || (def.baseSuccess != null ? Math.min(95, def.baseSuccess + ((a.quality||1)-1)*5) : null);
      const needs    = NEEDS[a.id] || (pct != null ? `${pct}% success` : 'passive');
      const lockTag  = locked ? ` 🔒 needs ${DEVICE_TIERS[required]?.name}` : '';
      return {
        name: `${def.emoji||'💻'} ${def.name||a.id} (T${a.quality||1}) — ${needs}${lockTag}`.slice(0, 100),
        value: a.id,
      };
    })
    .filter(c => c.name.toLowerCase().includes(focused))
    .slice(0, 25);

    return interaction.respond(choices.length ? choices : [{ name:'No matching apps', value:'__none__' }]).catch(()=>null);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    if (isBotBanned(interaction.user.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You are silenced.')], ephemeral:true });

    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    const user     = getOrCreateUser(userId);
    const _raw     = getLaptop(userId);
    const laptop   = _raw
      ? { deviceId: _raw.deviceId || 'builtin', deviceName: _raw.deviceName || 'Built-in Laptop', apps: Array.isArray(_raw.apps) ? _raw.apps.filter(a => a && typeof a === 'object' && a.id) : [], installedAt: _raw.installedAt || Date.now() }
      : { deviceId: 'builtin', deviceName: 'Built-in Laptop', apps: [], installedAt: Date.now() };
    const deviceId    = laptop.deviceId || 'builtin';
    const deviceTier  = DEVICE_TIERS[deviceId] || DEVICE_TIERS.builtin;
    const deviceLevel = DEVICE_ORDER.indexOf(deviceId);

    // ── OPEN ──────────────────────────────────────────────────
    if (sub === 'open') {
      const apps     = laptop.apps;
      const appLines = apps.length
        ? apps.map(a => {
            const def     = BUILTIN_APPS[a.id] || {};
            const pct     = def.baseSuccess != null ? `${Math.min(95, def.baseSuccess + ((a.quality||1)-1)*5)}% success` : 'passive';
            const reqDev  = def.requiresDevice;
            const locked  = reqDev && DEVICE_ORDER.indexOf(reqDev) > deviceLevel;
            const lockTag = locked ? ` 🔒 needs ${DEVICE_TIERS[reqDev]?.name}` : '';
            return `${def.emoji||'📦'} **${def.name||a.id}** (T${a.quality||1}) · ${pct}${lockTag}`;
          }).join('\n')
        : '*None — use `/laptop appstore` to install apps.*';

      const DEVICE_UPGRADE_HINT = deviceId === 'builtin'
        ? '\n\n⬆️ **Upgrade to Hacking Laptop** to unlock: SSN Scanner, Credit Cracker, Card Drainer, Biz Intruder, HomeHack'
        : deviceId === 'hack_laptop'
          ? '\n\n⬆️ **Upgrade to Political Laptop** (Illuminati Political Power) to unlock: Policy Intel, Voter Suppress, Blacksite Op, Classified Brief'
          : '';

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(deviceId === 'political_laptop' ? 0xf5c518 : deviceId === 'hack_laptop' ? 0x00d2ff : 0x888888)
        .setTitle(`${deviceTier.emoji} ${deviceTier.name}`)
        .setDescription(`*${deviceTier.desc}*${DEVICE_UPGRADE_HINT}`)
        .addFields(
          { name: '📋 Credit Fraud Workflow', value:
            '**①** Run **SSN Scanner** `target:@user` — steals & DMs you their SSN\n' +
            '**②** Run **Keylogger** — see your vault with the actual SSN number\n' +
            '**③** Run **Credit Cracker** `routing:<the SSN number>` — opens fraud card\n' +
            '**④** Run **Card Drainer** `target:@user` — maxes out their card\n' +
            '> *TOR-bought SSNs also appear in Keylogger vault.*',
            inline: false },
          { name: '📋 Business Hack Workflow', value:
            '**①** Get a routing# via `/myrouting`, Stalker App, or Bank Mirror\n' +
            '**②** Run **Biz Intruder** `routing:<number> action:check` — scout it\n' +
            '**③** Same command with `action:withdraw` or `action:launder`',
            inline: false },
          { name: '📱 Installed Apps', value: appLines.slice(0, 1020) || '—', inline: false },
        )
        .setFooter({ text:'/laptop appstore — install apps · /laptop run — execute an app' })
      ], ephemeral:true });
    }

    // ── APP STORE ─────────────────────────────────────────────
    if (sub === 'appstore') {
      const store      = getStore(interaction.guildId);
      const storeApps  = store.items.filter(i => i.effect?.type === 'laptop_app');
      const invAppItems = store.items.filter(i =>
        i.effect?.type === 'laptop_app' && (user.inventory||[]).includes(i.id)
      );
      const installedIds = (laptop.apps||[]).map(a => a.id);
      const basePct = { ssn_scanner:40, credit_cracker:35, card_drainer:45, biz_intrude:50, stalker_app:60, dark_search:55, launder_bot:65, bank_mirror:100 };

      // ── BUILD STORE BROWSE EMBED ──────────────────────────────
      const buildBrowseEmbed = () => {
        if (!storeApps.length) return new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('💻 App Store — Browse')
          .setDescription('No laptop apps have been added to the store yet.\n\nAsk an admin to add some via the dashboard.');

        const lines = storeApps.map(i => {
          const appId   = i.effect?.appId || i.id;
          const def     = BUILTIN_APPS[appId] || {};
          const q       = i.effect?.quality || 1;
          const pct     = i.effect?.successOverride || (basePct[appId] != null ? Math.min(95, basePct[appId]+(q-1)*5) : null);
          const owned   = (user.inventory||[]).includes(i.id);
          const instd   = installedIds.includes(appId);
          const status  = instd ? '✅ Installed' : owned ? '📦 In Inventory' : `$${(i.price||0).toLocaleString()}`;
          const descText = (def.desc||i.description||'').slice(0,120);
          return `${i.emoji||'💻'} **${i.name}** — Quality ${'⭐'.repeat(q)} · ${pct!=null?pct+'% success':'passive'}\n> *${descText}*\n${status}`;
        }).join('\n\n');

        return new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`💻 App Store — ${storeApps.length} Apps Available`)
          .setDescription(lines)
          .setFooter({ text:'Select an app below to buy or install it' });
      };

      // ── SELECT MENU (buy or install) ─────────────────────────
      const buildMenu = () => {
        const opts = storeApps.slice(0,25).map(i => {
          const appId  = i.effect?.appId || i.id;
          const def    = BUILTIN_APPS[appId] || {};
          const owned  = (user.inventory||[]).includes(i.id);
          const instd  = installedIds.includes(appId);
          const label  = instd ? `✅ ${i.name} (installed)` : owned ? `📦 ${i.name} (install)` : `🛒 ${i.name} — $${(i.price||0).toLocaleString()}`;
          return new StringSelectMenuOptionBuilder()
            .setLabel(label.slice(0,100))
            .setDescription((def.desc||i.description||'').slice(0,97) + ((def.desc||'').length > 97 ? '...' : ''))
            .setValue(i.id)
            .setEmoji(i.emoji||'💻');
        });
        if (!opts.length) return null;
        return new StringSelectMenuBuilder()
          .setCustomId('laptop_appstore_select')
          .setPlaceholder('Buy or install an app...')
          .addOptions(opts);
      };

      const menu = buildMenu();
      const components = menu ? [new ActionRowBuilder().addComponents(menu)] : [];
      await interaction.reply({ embeds:[buildBrowseEmbed()], components, ephemeral:true });

      if (!menu) return;
      const msg  = await interaction.fetchReply();
      const coll = msg.createMessageComponentCollector({ filter:i=>i.user.id===userId, time:90_000 });

      coll.on('collect', async si => {
        const itemId = si.values[0];
        const item   = store.items.find(i => i.id===itemId);
        if (!item) return si.update({ content:'Item not found.', components:[] });

        const appId   = item.effect?.appId || itemId;
        const def     = BUILTIN_APPS[appId] || { name:item.name, emoji:'📦', desc:'' };
        const quality = item.effect?.quality || 1;
        const pct     = item.effect?.successOverride || (basePct[appId] != null ? Math.min(95, basePct[appId]+(quality-1)*5) : null);

        // Already installed
        if (installedIds.includes(appId)) {
          return si.update({ embeds:[new EmbedBuilder().setColor(0x888888)
            .setDescription(`${def.emoji} **${def.name}** is already installed on your laptop.`)
          ], components });
        }

        // Owned in inventory — install it
        if ((user.inventory||[]).includes(itemId)) {
          const inv = user.inventory;
          inv.splice(inv.indexOf(itemId), 1);
          saveUser(userId, user);
          laptop.apps = [...(laptop.apps||[]), { id:appId, itemId, quality, installedAt:Date.now() }];
          await saveLaptop(userId, laptop);
          installedIds.push(appId);
          return si.update({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
            .setTitle(`${def.emoji} ${def.name} Installed!`)
            .setDescription(`**Quality Tier ${quality}** · Success rate: **${pct!=null?pct+'%':'passive'}**
*${def.desc}*

Use \`/laptop run\` to execute it.`)
          ], components:[new ActionRowBuilder().addComponents(buildMenu())] });
        }

        // Not owned — buy it now
        if (user.wallet < item.price) {
          return si.update({ embeds:[new EmbedBuilder().setColor(0xe74c3c)
            .setDescription(`${def.emoji} **${def.name}** costs **$${(item.price||0).toLocaleString()}**.
You have **$${user.wallet.toLocaleString()}** — not enough.

Deposit more money first.`)
          ], components });
        }

        user.wallet -= item.price;
        // Add to inventory then immediately install
        laptop.apps = [...(laptop.apps||[]), { id:appId, itemId, quality, installedAt:Date.now() }];
        saveUser(userId, user);
        await saveLaptop(userId, laptop);
        installedIds.push(appId);

        return si.update({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setTitle(`${def.emoji} ${def.name} Purchased & Installed!`)
          .setDescription(`**$${(item.price||0).toLocaleString()}** deducted · Quality Tier ${quality} · Success: **${pct!=null?pct+'%':'passive'}**
*${def.desc}*

Use \`/laptop run\` to execute it.

Wallet: **$${user.wallet.toLocaleString()}**`)
        ], components:[new ActionRowBuilder().addComponents(buildMenu())] });
      });
      return;
    }

    // ── RUN APP ───────────────────────────────────────────────
    if (sub === 'run') {
      const appId  = interaction.options.getString('app');
      const target = interaction.options.getUser('target');
      const def    = BUILTIN_APPS[appId];

      if (!def) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Unknown app.')], ephemeral:true });
      if (!hasApp(userId, appId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`${def.emoji} **${def.name}** not installed.\n\nGet it from the item store and install via \`/laptop appstore\`.`)
      ], ephemeral:true });

      // ── DEVICE TIER GATE ─────────────────────────────────
      if (def.requiresDevice) {
        const reqLevel = DEVICE_ORDER.indexOf(def.requiresDevice);
        if (deviceLevel < reqLevel) {
          const reqTier = DEVICE_TIERS[def.requiresDevice];
          return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setTitle(`🔒 ${reqTier.name} Required`)
            .setDescription(
              `**${def.name}** requires a **${reqTier.name}**.\n\nYour current device: **${deviceTier.name}**\n\n${reqTier.desc}\n\n` +
              `Purchase a **${reqTier.name}** from the server store, then use \`/use <item>\` to upgrade.`
            )
          ], ephemeral:true });
        }
      }

      const successRate = getEffectiveSuccess(userId, appId);
      const success     = Math.random() * 100 < successRate;

      await interaction.deferReply(); // public — app runs are visible to everyone

      // ── SSN SCANNER ───────────────────────────────────────
      if (appId === 'ssn_scanner') {
        if (!target) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target.')], components:[] });
        if (!success) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('💻 Scan Failed').setDescription(`Couldn't breach <@${target.id}>'s security. (${successRate}% chance)`)], components:[] });

        const vc = await getOrCreateCredit(target.id);
        const hc = await getOrCreateCredit(userId);
        if (!hc.ssnStolen) hc.ssnStolen = {};
        hc.ssnStolen[target.id] = { ssn:vc.ssn, partial:false, score:vc.score, at:Date.now() };
        await saveCredit(userId, hc);
        try { const { addHeat } = require('../../utils/gangDb'); await addHeat(userId, 20, 'SSN scan'); } catch {}

        setTimeout(async () => {
          target.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setTitle('⚠️ Suspicious Activity').setDescription('Unusual activity detected on your financial profile. Check /credit check.')] }).catch(e => null);
        }, 5*60*1000);

        // DM the attacker the full SSN (private)
        await interaction.user.send({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setTitle('🪪 SSN Captured — Private')
          .setDescription(`**Full SSN:** \`${vc.ssn}\`\n**Score:** ${vc.score} (${getCreditTier(vc.score).label})\n\nSaved to your hacker profile. Run **/laptop run app:credit_cracker** next.`)
        ]}).catch(() => null);
        // Public embed — masked
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setTitle(`🪪 ${interaction.user.username} ran SSN Scanner on <@${target.id}>`)
          .setDescription(`Scan successful. SSN captured.\n\nScore: **${vc.score}** (${getCreditTier(vc.score).label})\n\n*Full SSN sent to attacker via DM.*`)
          .setFooter({ text:`${successRate}% success rate` })
        ], components:[] });
      }

      // ── CREDIT CRACKER ────────────────────────────────────
      if (appId === 'credit_cracker') {
        const ssnInput = interaction.options.getString('routing')?.trim();
        if (!ssnInput) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setTitle('💳 SSN Required')
          .setDescription(
            'Credit Cracker requires the **actual SSN number** — not just a user tag.\n\n' +
            '**Step-by-step:**\n' +
            '① Run **SSN Scanner** on a target (or buy their SSN on `/tor market`)\n' +
            '② Run **Keylogger** — it shows your vault with the full SSN numbers\n' +
            '③ Come back here and enter the SSN in the `routing:` field\n\n' +
            '*Example: `/laptop run app:Credit Cracker routing:512-34-7890`*'
          )
        ], components:[] });

        const hc = await getOrCreateCredit(userId);
        const vault = hc.ssnStolen || {};
        // Find which victim this SSN belongs to
        const victimId = Object.keys(vault).find(uid => vault[uid]?.ssn === ssnInput);
        if (!victimId) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setTitle('❌ SSN Not in Vault')
          .setDescription(
            `\`${ssnInput}\` is not in your stolen SSN vault.\n\n` +
            '**Run Keylogger** to see every SSN you\'ve collected and their exact numbers.\n\n' +
            'SSNs are added by:\n• **SSN Scanner** → scan a target\n• **TOR market** → buy stolen data'
          )
        ], components:[] });

        const vc = await getOrCreateCredit(victimId);
        if (vc.frozen) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Target has a credit freeze active.')], components:[] });
        const tier = getCreditTier(vc.score);
        if (!tier.card) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Target score too low for a card (580+ required).')], components:[] });
        if (!success) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('💻 Crack Failed').setDescription('Security blocked the attempt. (' + successRate + '% chance)')], components:[] });

        const tv   = getOrCreateUser(victimId);
        const limit= Math.floor((tv.bank||0)*(tier.limitPct||0.2)*0.5);
        const amt  = Math.floor(limit*(0.5+Math.random()*0.5));
        user.wallet += amt;
        vc.balance   = (vc.balance||0)+amt;
        if (!vc.card) { vc.card=tier.card; vc.limit=limit; }
        await adjustScore(victimId, -45, 'Fraud via Credit Cracker');
        saveUser(userId, user);
        await saveCredit(victimId, vc);
        try { const { addHeat } = require('../../utils/gangDb'); await addHeat(userId, 35, 'credit fraud'); } catch {}
        try { const vu = await interaction.client.users.fetch(victimId); await vu.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setTitle('Fraud Alert').setDescription('A fraudulent card was opened on your SSN. $' + amt.toLocaleString() + ' charged. Score -45. Freeze with /credit freeze!')] }); } catch {}
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xf5c518).setTitle('💳 Fraud Successful').setDescription('Opened **' + tier.card + '** on the stolen SSN.\n\nVictim: <@' + victimId + '>\nStolen: **' + fmtMoney(amt) + '** added to your wallet\nScore hit: **-45**')], components:[] });
      }

      // ── CARD DRAINER ──────────────────────────────────────
      if (appId === 'card_drainer') {
        if (!target) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription('Specify a **target:** user.\n\nYou must scan them with **SSN Scanner** first to get their card info.')
        ], components:[] });
        const hc2 = await getOrCreateCredit(userId);
        if (!hc2.ssnStolen?.[target.id]) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`No SSN on file for <@${target.id}>.\n\nRun **SSN Scanner** on them first.`)
        ], components:[] });
        let victimId2 = target.id;
        const vc2 = await getOrCreateCredit(victimId2);
        if (!vc2.card) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No card linked to that SSN. Use Credit Cracker to open one first.')], components:[] });
        if (!success) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('💻 Drain Failed').setDescription('Card drain blocked. (' + successRate + '% chance)')], components:[] });

        const avail = (vc2.limit||0)-(vc2.balance||0);
        if (avail < 100) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Card already maxed out.')], components:[] });
        user.wallet += avail;
        vc2.balance += avail;
        await adjustScore(victimId2, -25, 'Card drained');
        saveUser(userId, user);
        await saveCredit(victimId2, vc2);
        try { const vu2 = await interaction.client.users.fetch(victimId2); await vu2.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setTitle('Card Drained').setDescription('Your card was remotely drained. $' + avail.toLocaleString() + ' stolen. Score -25.')] }); } catch {}
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xf5c518).setTitle('💸 Card Drained').setDescription('Drained **' + fmtMoney(avail) + '** from the card.\n\nVictim: <@' + victimId2 + '>\nScore hit: **-25**')], components:[] });
      }

      // ── BIZ INTRUDER ──────────────────────────────────────
      if (appId === 'biz_intrude') {
        const routingNum = interaction.options.getString('routing')?.trim().toUpperCase();
        const action     = interaction.options.getString('action') || 'check';
        const amount     = interaction.options.getInteger('amount');
        if (!routingNum) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a routing number.')], components:[] });

        const ownerId = await getUserByRouting(routingNum);
        if (!ownerId) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Routing \`${routingNum}\` not found.`)], components:[] });
        const biz = getBusiness(ownerId);
        if (!biz) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No active business at that routing number.')], components:[] });

        const ownerGang  = getGangByMember(ownerId);
        let goonData     = null; let dirtyMoney = 0;
        if (ownerGang) { goonData = getGangGoons(ownerGang.id); dirtyMoney = goonData?.dirtyMoney||0; }

        if (action === 'check') {
          return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x00d2ff)
            .setTitle(`💻 ${biz.name} — Account Access`)
            .addFields(
              { name:'✅ Clean Revenue', value:fmtMoney(biz.revenue||0), inline:true },
              { name:'💊 Dirty Money',   value:fmtMoney(dirtyMoney),     inline:true },
            )
          ], components:[] });
        }

        if (!success) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('💻 Access Denied').setDescription(`Security countermeasures blocked access. (${successRate}% chance)`)], components:[] });

        if (action === 'withdraw') {
          const amt  = amount || biz.revenue;
          if (!amt || amt > (biz.revenue||0)) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Only ${fmtMoney(biz.revenue||0)} available.`)], components:[] });
          biz.revenue -= amt;
          user.wallet += amt;
          await saveBusiness(ownerId, biz);
          saveUser(userId, user);
          return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('💸 Funds Withdrawn').setDescription(`Drained **${fmtMoney(amt)}** from **${biz.name}** → your wallet.`)], components:[] });
        }

        if (action === 'launder') {
          if (!dirtyMoney) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No dirty money to launder.')], components:[] });
          const amt  = amount || dirtyMoney;
          const laundered = Math.floor(amt * 0.60); // 60% rate via laptop
          if (goonData) { goonData.dirtyMoney = Math.max(0, dirtyMoney-amt); await saveGangGoons(ownerGang.id, goonData); }
          user.wallet += laundered;
          saveUser(userId, user);
          return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('🧺 Launder Complete').setDescription(`Laundered **${fmtMoney(amt)}** dirty → **${fmtMoney(laundered)}** clean (60%).`)], components:[] });
        }
      }

      // ── STALKER APP ───────────────────────────────────────
      if (appId === 'stalker_app') {
        if (!target) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target.')], components:[] });
        if (!success) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('💻 Trace Failed').setDescription(`Couldn't locate target. (${successRate}% chance)`)], components:[] });

        const { getUser }         = require('../../utils/db');
        const { getHome }         = require('../../utils/homeDb');
        const { getPhone, getStatusTier } = require('../../utils/phoneDb');
        const { getBusiness: _gb} = require('../../utils/bizDb');
        const { getGangByMember } = require('../../utils/gangDb');

        const tv    = getUser(target.id);
        const home  = getHome(target.id);
        const phone = getPhone(target.id);
        const tbiz  = _gb(target.id);
        const tgang = getGangByMember(target.id);
        const ttier = getStatusTier(phone?.status||0);

        // Also pull routing and credit
        let tRouting = null;
        try { const {col:_sc}=require('../../utils/mongo'); const rc=await _sc('routingNumbers'); const rd=await rc.findOne({_id:target.id}); tRouting=rd?.routing||null; } catch {}
        const { getCredit } = require('../../utils/creditDb');
        const tCredit = getCredit(target.id);
        // Also get debit card number (masked)
        const { getDebitCard } = require('../../utils/debitDb');
        const tDebit = getDebitCard(target.id);
        // Store the stolen card number for later use
        if (tDebit && !tDebit.frozen) {
          try {
            const hc2 = await getOrCreateCredit(userId);
            if (!hc2.stolenCards) hc2.stolenCards = {};
            hc2.stolenCards[target.id] = { cardNumber:tDebit.cardNumber, stolenAt:Date.now() };
            await saveCredit(userId, hc2);
          } catch {}
        }

        return interaction.editReply({ embeds:[new EmbedBuilder()
          .setColor(0x2c2f73)
          .setTitle(`👁️ ${interaction.user.username} — Intel on ${target.username}`)
          .addFields(
            { name:'💵 Wallet',    value:fmtMoney(tv?.wallet||0),                       inline:true },
            { name:'🏦 Bank',      value:fmtMoney(tv?.bank||0),                         inline:true },
            { name:'📱 Status',    value:ttier?.label||'None',                           inline:true },
            { name:'🏠 Home',      value:home?`${home.tier} · ${(home.stash||[]).length} stash`:'None', inline:true },
            { name:'🏢 Business',  value:tbiz?`${tbiz.name} Lv${tbiz.level||1}`:'None', inline:true },
            { name:'🏴 Gang',      value:tgang?.name||'None',                            inline:true },
            { name:'📊 Credit',    value:tCredit?`Score: ${tCredit.score}${tCredit.frozen?' ❄️':''}`:'No profile', inline:true },
            { name:'🏦 Routing #',  value:tRouting?('`'+tRouting+'`'):'None on file',    inline:true },
            { name:'💳 Debit Card', value:tDebit&&!tDebit.frozen ? ('`'+tDebit.cardNumber+'`  ⚠️ Stolen & saved') : tDebit?.frozen ? '❄️ Frozen — blocked' : 'No card', inline:false },
          )
        ], components:[] });
      }

      // ── LAUNDER BOT ───────────────────────────────────────
      if (appId === 'launder_bot') {
        const ownerGang = getGangByMember(userId);
        if (!ownerGang) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You need to be in a gang with dirty money.')], components:[] });
        const gd = getGangGoons(ownerGang.id);
        const dirty = gd?.dirtyMoney || 0;
        if (!dirty) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No dirty money to launder.')], components:[] });

        const appQuality = getLaptop(userId)?.apps?.find(a=>a.id==='launder_bot')?.quality || 1;
        const rate       = Math.min(0.85, 0.60 + appQuality * 0.05); // 65%-85%
        const amt        = interaction.options.getInteger('amount') || dirty;
        const laundered  = Math.floor(Math.min(amt, dirty) * rate);

        gd.dirtyMoney = Math.max(0, dirty - amt);
        await saveGangGoons(ownerGang.id, gd);
        user.wallet += laundered;
        saveUser(userId, user);

        return interaction.editReply({ embeds:[new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('🧺 LaunderBot Complete')
          .setDescription(`Laundered **${fmtMoney(amt)}** dirty → **${fmtMoney(laundered)}** clean\n\nRate: **${Math.round(rate*100)}%** (Quality Tier ${appQuality})`)
        ], components:[] });
      }

      // ── DARK SEARCH ───────────────────────────────────────
      if (appId === 'dark_search') {
        // Search TOR market by SSN fragment or routing number
        const query = interaction.options.getString('routing')?.trim().toUpperCase()
                   || (target ? target.id : null);
        if (!query) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Provide a `routing:` number or `target:` user to search for.')], components:[] });

        if (!success) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('🔍 Search Failed').setDescription(`Dark web servers didn't respond. (${successRate}% chance)`)], components:[] });

        const { getActiveListings } = require('../../utils/torDb');
        const listings = getActiveListings();
        // Search by victimId (if target given) or routing number in data
        const matches = listings.filter(l =>
          (target && l.victimId === target.id) ||
          (!target && (l.data?.routingNumber === query || l.data?.ssn?.includes(query)))
        ).slice(0, 5);

        if (!matches.length) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2c2c2c).setTitle('🔍 DarkSearch — No Results').setDescription('No listings found for that query on the dark web.')], components:[] });

        const lines = matches.map((l, i) =>
          `**${i+1}.** \`${l.id.slice(-6)}\` — ${l.typeName}\nPrice: **${fmtMoney(l.price)}** · Seller: \`${l.sellerHandle}\``
        ).join('\n\n');

        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x0a0a0a).setTitle('🔍 DarkSearch Results').setDescription(lines).setFooter({ text:'Use /tor buy listing_id: to purchase' })], components:[] });
      }

      // ── BANK MIRROR ───────────────────────────────────────
      if (appId === 'bank_mirror') {
        // Read any routing number — 100% success rate, passive tool
        const routingNum = interaction.options.getString('routing')?.trim().toUpperCase();
        if (!routingNum) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Provide a `routing:` number to mirror.')], components:[] });

        const ownerId2 = await getUserByRouting(routingNum);
        if (!ownerId2) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Routing \`${routingNum}\` not found in banking system.`)], components:[] });

        const biz2 = getBusiness(ownerId2);
        const u2   = getOrCreateUser(ownerId2);
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x00d2ff)
          .setTitle(`🏦 ${interaction.user.username} mirrored routing \`${routingNum}\``)
          .setDescription(`*Read-only access to banking system established.*`)
          .addFields(
            { name:'🪪 Account Owner', value:`<@${ownerId2}>`,             inline:true },
            { name:'💵 Wallet',        value:fmtMoney(u2.wallet||0),       inline:true },
            { name:'🏦 Bank Balance',  value:fmtMoney(u2.bank||0),         inline:true },
            { name:'🏢 Business Rev',  value:biz2 ? fmtMoney(biz2.revenue||0) : '—', inline:true },
            { name:'🔢 Routing #',     value:`\`${routingNum}\``,          inline:true },
          )
        ], components:[] });
      }

      // ── KEYLOGGER ─────────────────────────────────────────
      if (appId === 'keylogger') {
        // Passive — buffs phishing/hacking success while installed
        // When run directly, shows current intercepts from any recent phishing
        const hc = await getOrCreateCredit(userId);
        const allIntercepts = Object.entries(hc.ssnStolen || {});

        if (!allIntercepts.length) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2c2c2c)
          .setTitle('⌨️ Stolen SSN Vault — Empty')
          .setDescription('No SSNs on file yet.\n\n**How to get SSNs:**\n• `/laptop run SSN Scanner target:@user` — steal directly\n• `/tor buy` — purchase from the dark web market\n\n*Keylogger also passively boosts all hack success by +20% while installed.*')
        ], components:[] });

        const lines = allIntercepts.slice(-10).map(([uid, d]) => {
          const src = d.source === 'tor_market' ? '🌐 TOR buy' : '🪪 Scanned';
          return `<@${uid}> — \`${d.ssn||'?'}\` · Score: **${d.score||'?'}** · ${src}`;
        }).join('\n');

        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2c2c2c)
          .setTitle('⌨️ Stolen SSN Vault')
          .setDescription(`${lines}\n\n**Next step:** Copy an SSN number above, then run:\n\`/laptop run app:Credit Cracker routing:<SSN number>\``)
        ], components:[] });
      }

      // ── VPN SHIELD ────────────────────────────────────────
      if (appId === 'vpn_shield') {
        // Passive — run to check current TOR trace protection status
        const { TOR_TRACE_CHANCE, TOR_VPN_REDUCTION } = require('../../utils/torDb');
        const laptop2   = getLaptop(userId);
        const appCount  = (laptop2?.apps||[]).length;
        let traceChance = TOR_TRACE_CHANCE * (1 - TOR_VPN_REDUCTION);
        traceChance    *= Math.max(0.1, 1 - appCount * 0.05);
        const pct       = Math.round(traceChance * 100);

        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x3498db)
          .setTitle('🛡️ VPN Shield — Active')
          .setDescription(`Your TOR connections are protected.

📉 Current trace risk: **${pct}%**
🔒 Apps installed: **${appCount}** (each -5% trace risk)

*VPN Shield runs passively. No action required.*`)
        ], components:[] });
      }

      // ── HOME HACK ─────────────────────────────────────────
      if (appId === 'home_hack') {
        if (!target) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target homeowner with target:')], components:[] });
        if (!success) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('🏚️ Security Bypass Failed').setDescription('Security system held firm. (' + successRate + '% chance)')], components:[] });
        const { getHome, saveHome } = require('../../utils/homeDb');
        const home = getHome(target.id);
        if (!home) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('<@' + target.id + '> does not own a home.')], components:[] });
        home.securityBypassedUntil = Date.now() + 30 * 60 * 1000;
        home.securityBypassedBy    = userId;
        await saveHome(target.id, home);
        target.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setTitle('🚨 Home Security Compromised!').setDescription('Your home security system was remotely disabled. You are vulnerable for 30 minutes. Someone may attempt to break in.')] }).catch(() => null);
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2ecc71)
          .setTitle(interaction.user.username + ' hacked <@' + target.id + '> security!')
          .setDescription('<@' + target.id + "> home security is **OFFLINE** for 30 minutes.\n\n• Break-in defense is **0%** until reset\n• Security camera disabled\n• Max break-in success chance\n\nStrike with `/use break-in-kit target:" + target.username + '`')
          .setFooter({ text:'Security resets automatically after 30 minutes' })
        ], components:[] });
      }

            // ── TOR BROWSER ───────────────────────────────────────
      if (appId === 'tor_browser') {
        const { TOR_TRACE_CHANCE, TOR_VPN_REDUCTION } = require('../../utils/torDb');
        const laptop2   = getLaptop(userId);
        const hasVPN    = (laptop2?.apps||[]).some(a => a.id === 'vpn_shield');
        let traceChance = TOR_TRACE_CHANCE;
        if (hasVPN) traceChance *= (1 - TOR_VPN_REDUCTION);
        traceChance *= 0.80; // TOR Browser adds extra -20%
        const appCount  = (laptop2?.apps||[]).length;
        traceChance    *= Math.max(0.1, 1 - appCount * 0.05);
        const pct       = Math.round(traceChance * 100);
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x1a1a1a)
          .setTitle('🌐 TOR Browser — Connected')
          .setDescription(
            'You are connected to the dark web marketplace.\n\n' +
            '**How to use the TOR Market:**\n' +
            '`/tor market` — Browse all active listings (stolen SSNs, routing numbers, identities)\n' +
            '`/tor buy listing_id:<ID>` — Purchase a listing using its 6-character ID\n' +
            '`/tor sell type: price:` — List your own stolen data for sale\n' +
            '`/tor profile` — View your dark web reputation and handle\n\n' +
            '**Your protection:**\n' +
            `📉 Current trace risk: **${pct}%**${hasVPN ? ' (VPN active)' : ''}\n` +
            `🌐 TOR Browser bonus: **-20% trace risk**\n\n` +
            '*Higher quality TOR Browser reduces trace risk further.*'
          )
        ], components:[] });
      }

      // ── POLITICAL APPS (requires political_laptop + Political Power faction) ───
      const POLITICAL_APP_IDS = ['policy_intel', 'voter_suppress', 'blacksite_op', 'classified_brief'];
      if (POLITICAL_APP_IDS.includes(appId)) {
        const { getMember } = require('../../utils/illuminatiDb');
        const mem = getMember(interaction.guildId, userId);
        if (mem?.faction !== 'political_power') {
          return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setTitle('🏛️ Political Power Faction Required')
            .setDescription('Political laptop apps require Illuminati **Political Power** faction membership.\n\nJoin the Illuminati and align with the Political Power faction to unlock these operations.')
          ], components:[] });
        }

        // ── POLICY INTEL ──────────────────────────────────────
        if (appId === 'policy_intel') {
          const { getAllUsers } = require('../../utils/db');
          const allUsers  = getAllUsers();
          const ranked    = Object.entries(allUsers)
            .map(([uid, u]) => ({ uid, total: (u.wallet||0) + (u.bank||0) }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);

          const lines = ranked.map((r, i) =>
            `**${i+1}.** <@${r.uid}> — ${fmtMoney(r.total)}`
          ).join('\n');

          return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xf5c518)
            .setTitle('🏛️ Policy Intel — Classified Economy Report')
            .setDescription('*Clearance level: POLITICAL POWER*')
            .addFields(
              { name:'💰 Top 10 Wealthiest Users (Wallet + Bank)', value:lines || 'No data', inline:false },
              { name:'📊 Server Summary', value:`Active users: **${Object.keys(allUsers).length}**`, inline:false },
            )
          ], components:[] });
        }

        // ── VOTER SUPPRESS ────────────────────────────────────
        if (appId === 'voter_suppress') {
          if (!target) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target with `target:@user`.')], components:[] });
          if (!success) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('🗳️ Suppression Failed').setDescription(`Target evaded the suppression. (${successRate}% chance)`)], components:[] });

          const tv = getOrCreateUser(target.id);
          tv.suppressedUntil = Date.now() + 24 * 3600 * 1000;
          saveUser(target.id, tv);

          target.send({ embeds:[new EmbedBuilder().setColor(0x888888)
            .setTitle('🗳️ Income Suppressed')
            .setDescription('A covert operation has restricted your daily and work income for **24 hours**.\n\n*Someone doesn\'t want you to earn today.*')
          ]}).catch(() => null);

          return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xf5c518)
            .setTitle(`🗳️ ${interaction.user.username} suppressed <@${target.id}>`)
            .setDescription(`<@${target.id}>'s daily and work income is blocked for **24 hours**.\n\nZero trace. Zero evidence.\n\n*Political Power is the cleanest power.*`)
          ], components:[] });
        }

        // ── BLACKSITE OP ──────────────────────────────────────
        if (appId === 'blacksite_op') {
          if (!target) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target with `target:@user`.')], components:[] });
          if (!success) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('🕵️ Op Burned').setDescription(`The operation was compromised. (${successRate}% chance)`)], components:[] });

          const tv2   = getOrCreateUser(target.id);
          const take  = Math.floor((tv2.wallet||0) * 0.12);
          if (take < 100) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Target has less than $1000 — not worth the op.')], components:[] });

          tv2.wallet  -= take;
          user.wallet += take;
          saveUser(target.id, tv2);
          saveUser(userId, user);

          return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x1a1a2e)
            .setTitle(`🕵️ ${interaction.user.username} ran a Blacksite Op on <@${target.id}>`)
            .setDescription(`**${fmtMoney(take)}** extracted.\n\nNo evidence. No heat. No trace.\n\n*This operation does not exist.*`)
          ], components:[] });
        }

        // ── CLASSIFIED BRIEF ──────────────────────────────────
        if (appId === 'classified_brief') {
          if (!target) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target with `target:@user`.')], components:[] });

          const { getHome: _gh } = require('../../utils/homeDb');
          const { getPhone: _gp, getStatusTier } = require('../../utils/phoneDb');
          const { getBusiness: _gb } = require('../../utils/bizDb');
          const { isMember: _im, getMember: _gm } = require('../../utils/illuminatiDb');
          const { getCredit: _gc } = require('../../utils/creditDb');

          const tv3   = getOrCreateUser(target.id);
          const home3 = _gh(target.id);
          const ph3   = _gp(target.id);
          const biz3  = _gb(target.id);
          const cred3 = _gc(target.id);
          const illMem = _im(interaction.guildId, target.id);
          const isPup  = (require('../../utils/illuminatiDb').getIlluminati(interaction.guildId)?.puppets||[]).some(p => p.userId === target.id);
          const voodoo = tv3.voodoo;

          const illuStatus = illMem
            ? `🔺 Member (${_gm(interaction.guildId, target.id)?.rank})`
            : isPup ? '⛓️ Puppet' : 'Not involved';

          return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xf5c518)
            .setTitle(`📋 Classified Brief — <@${target.id}>`)
            .setDescription('*CLASSIFIED — Political Power clearance required*')
            .addFields(
              { name:'💵 Wallet',     value:fmtMoney(tv3.wallet||0),             inline:true },
              { name:'🏦 Bank',       value:fmtMoney(tv3.bank||0),               inline:true },
              { name:'🏠 Home',       value:home3?.tier||'None',                  inline:true },
              { name:'🏢 Business',   value:biz3?`${biz3.name} Lv${biz3.level||1}`:'None', inline:true },
              { name:'📊 Credit',     value:cred3?`Score ${cred3.score}${cred3.frozen?' ❄️':''}`:'None', inline:true },
              { name:'🔺 Illuminati', value:illuStatus,                           inline:true },
              { name:'🕯️ Voodoo',    value:voodoo?.initiated ? `⚡ ${voodoo.energy||0} energy · ${voodoo.ritualCount||0} rituals` : 'Not initiated', inline:true },
              { name:'📱 Status',     value:getStatusTier(ph3?.status||0)?.label||'None', inline:true },
            )
          ], components:[] });
        }
      }

      return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('Unknown app.')], components:[] });
    }
  },
};
