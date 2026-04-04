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
const { getLaptop, saveLaptop, hasApp, BUILTIN_APPS, getEffectiveSuccess } = require('../../utils/laptopDb');
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
      .addStringOption(o => o.setName('app').setDescription('App to run').setRequired(true).setAutocomplete(true))
      .addUserOption(o => o.setName('target').setDescription('🎯 Required for: SSN Scanner, Credit Cracker, Card Drainer, Stalker App, HomeHack, DarkSearch').setRequired(false))
      .addStringOption(o => o.setName('routing').setDescription('🏦 Required for: Biz Intruder, Bank Mirror — enter routing number here').setRequired(false))
      .addStringOption(o => o.setName('action').setDescription('⚡ Biz Intruder only — what to do once inside').setRequired(false)
        .addChoices(
          { name:'📊 Check Balances — see revenue & dirty money', value:'check' },
          { name:'💵 Withdraw Revenue — steal clean revenue', value:'withdraw' },
          { name:'🧺 Launder Dirty Money — clean their dirty cash', value:'launder' },
        ))
      .addIntegerOption(o => o.setName('amount').setDescription('💰 Biz Intruder only — amount to withdraw or launder').setRequired(false).setMinValue(1))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const userId  = interaction.user.id;
    const laptop  = getLaptop(userId);
    const apps    = laptop?.apps || [];

    if (!apps.length) {
      return interaction.respond([{ name:'No apps installed — use /laptop appstore first', value:'__none__' }]).catch(()=>null);
    }

    // What each app needs shown inline so user knows what to fill in
    const NEEDS = {
      ssn_scanner:    'needs: target:@user',
      credit_cracker: 'needs: ssn:<paste-stolen-ssn> (from /tor buy)',
      card_drainer:   'needs: ssn:<paste-stolen-ssn> (from /tor buy)',
      biz_intrude:    'needs: routing:<number> + action:',
      bank_mirror:    'needs: routing:<number>',
      stalker_app:    'needs: target:@user',
      dark_search:    'needs: target:@user  OR  routing:<number>',
      home_hack:      'needs: target:@user',
      keylogger:      'passive — no inputs needed',
      vpn_shield:     'passive — no inputs needed',
      launder_bot:    'passive — no inputs needed',
      tor_browser:    'passive — no inputs needed',
    };

    const choices = apps.map(a => {
      const def   = BUILTIN_APPS[a.id] || {};
      const pct   = a.successOverride || (def.baseSuccess != null ? Math.min(95, def.baseSuccess + ((a.quality||1)-1)*5) : null);
      const needs = NEEDS[a.id] || (pct != null ? `${pct}% success` : 'passive');
      return {
        name: `${def.emoji||'💻'} ${def.name||a.id} (T${a.quality||1}) — ${needs}`,
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

    // ── Must own a laptop device item ─────────────────────────
    const user   = getOrCreateUser(userId);
    const store  = getStore(interaction.guildId);
    const device = store.items.find(i =>
      (i.effect?.type === 'laptop' || (i.id||'').toLowerCase().includes('laptop') || (i.name||'').toLowerCase().includes('laptop')) &&
      (user.inventory||[]).includes(i.id)
    );
    if (!device) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setTitle('💻 No Laptop')
      .setDescription('You need a **laptop** from the shop first.\n\nBuy one with `/shop` or check the item store.')
    ], ephemeral:true });

    let laptop = getLaptop(userId) || { deviceId:device.id, deviceName:device.name, apps:[], installedAt:Date.now() };

    // ── OPEN ──────────────────────────────────────────────────
    if (sub === 'open') {
      const apps   = laptop.apps || [];
      const appLines = apps.length
        ? apps.map(a => {
            const def = BUILTIN_APPS[a.id] || {};
            return `${def.emoji||'📦'} **${def.name||a.id}** — Quality Tier ${a.quality||1} · *${def.desc||a.desc||''}*`;
          }).join('\n')
        : '*No apps installed. Use `/laptop appstore` to browse.*';

      const categories = [...new Set(apps.map(a => BUILTIN_APPS[a.id]?.category||'other'))];

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x00d2ff)
        .setTitle(`💻 ${device.name}`)
        .setDescription(`**${apps.length}** apps installed\nCapabilities: ${categories.length ? categories.join(', ') : 'none yet'}`)
        .addFields({ name:'📱 Installed Apps', value:appLines })
        .setFooter({ text:'Use /laptop appstore to install apps · /laptop run <app> to execute' })
      ], ephemeral:true });
    }

    // ── APP STORE ─────────────────────────────────────────────
    if (sub === 'appstore') {
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
        const ssnInput = interaction.options.getString('ssn');
        let victimId = null;
        // Path 1: ssn: field — look up who owns this SSN (from /tor buy)
        if (ssnInput) {
          try {
            const { col: _mCol } = require('../../utils/mongo');
            const _cc = await _mCol('credit');
            const _doc = await _cc.findOne({ ssn: ssnInput.trim() });
            if (_doc) victimId = _doc._id;
          } catch {}
          if (!victimId) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('SSN `' + ssnInput + '` not found. Check you copied it correctly from /tor buy.')
          ], components:[] });
        // Path 2: target: field — use SSN already scanned from that user
        } else if (target) {
          const hc = await getOrCreateCredit(userId);
          if (!hc.ssnStolen?.[target.id]) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('No SSN on file for that user. Either scan them with SSN Scanner first, or paste their SSN from /tor buy into the ssn: field.')
          ], components:[] });
          victimId = target.id;
        } else {
          return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('Provide one of:\n**ssn:** — paste a stolen SSN you bought from /tor market\n**target:** — a user whose SSN you already scanned with SSN Scanner')
          ], components:[] });
        }
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
        const ssnInput2 = interaction.options.getString('ssn');
        let victimId2 = null;
        if (ssnInput2) {
          try {
            const { col: _mCol2 } = require('../../utils/mongo');
            const _cc2 = await _mCol2('credit');
            const _doc2 = await _cc2.findOne({ ssn: ssnInput2.trim() });
            if (_doc2) victimId2 = _doc2._id;
          } catch {}
          if (!victimId2) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('SSN `' + ssnInput2 + '` not found. Check you copied it correctly.')
          ], components:[] });
        } else if (target) {
          const hc2 = await getOrCreateCredit(userId);
          if (!hc2.ssnStolen?.[target.id]) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('No SSN on file for that user. Paste the stolen SSN into the ssn: field instead.')
          ], components:[] });
          victimId2 = target.id;
        } else {
          return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription('Provide **ssn:** (paste stolen SSN from /tor buy) or **target:** (user you already scanned).')
          ], components:[] });
        }
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
        const intercepts = Object.entries(hc.ssnStolen || {}).slice(-5);

        if (!intercepts.length) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2c2c2c)
          .setTitle('⌨️ Keylogger — No Intercepts')
          .setDescription('No keystroke data captured yet.\n\nKeylogger passively boosts all phishing/hacking success by **+20%** while installed.')
        ], components:[] });

        const lines = intercepts.map(([uid, d]) =>
          `<@${uid}> — SSN: \`${d.ssn||'?'}\` · Score: **${d.score||'?'}**`
        ).join('\n');
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2c2c2c)
          .setTitle('⌨️ Keylogger — Captured Credentials')
          .setDescription(lines)
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

      return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('Unknown app.')], components:[] });
    }
  },
};
