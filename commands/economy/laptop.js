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
      .addStringOption(o => o.setName('app').setDescription('App to run — only shows your installed apps').setRequired(true).setAutocomplete(true))
      .addUserOption(o => o.setName('target').setDescription('Target user (for hacking/intel apps)').setRequired(false))
      .addStringOption(o => o.setName('routing').setDescription('Routing number (for Biz Intruder)').setRequired(false))
      .addStringOption(o => o.setName('action').setDescription('Action for Biz Intruder (check/withdraw/launder)').setRequired(false)
        .addChoices(
          { name:'📊 Check Balances', value:'check' },
          { name:'💵 Withdraw Revenue', value:'withdraw' },
          { name:'🧺 Launder Dirty Money', value:'launder' },
        ))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount (for launder/withdraw)').setRequired(false).setMinValue(1))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const userId  = interaction.user.id;
    const laptop  = getLaptop(userId);
    const apps    = laptop?.apps || [];

    if (!apps.length) {
      return interaction.respond([{ name:'No apps installed — use /laptop appstore', value:'__none__' }]);
    }

    const choices = apps
      .map(a => {
        const def = BUILTIN_APPS[a.id] || {};
        return {
          name: `${def.emoji||'💻'} ${def.name||a.id} (Tier ${a.quality||1})`,
          value: a.id,
        };
      })
      .filter(c => c.name.toLowerCase().includes(focused))
      .slice(0, 25);

    return interaction.respond(choices.length ? choices : [{ name:'No matching apps', value:'__none__' }]);
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
          return `${i.emoji||'💻'} **${i.name}** — ${def.desc||i.description||''}\nQuality: ${'⭐'.repeat(q)} · Success: ${pct!=null?pct+'%':'passive'} · ${status}`;
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
            .setDescription((def.desc||i.description||'').slice(0,100))
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

      await interaction.deferReply({ ephemeral:true });

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

        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('🪪 SSN Captured').setDescription(`<@${target.id}>'s SSN: \`${vc.ssn}\`\nScore: **${vc.score}** (${getCreditTier(vc.score).label})\n\nRun **Credit Cracker** or **Card Drainer** next.`)], components:[] });
      }

      // ── CREDIT CRACKER ────────────────────────────────────
      if (appId === 'credit_cracker') {
        if (!target) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target.')], components:[] });
        const hc = await getOrCreateCredit(userId);
        if (!hc.ssnStolen?.[target.id]) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`No SSN on file for <@${target.id}>. Run SSN Scanner first.`)], components:[] });
        const vc = await getOrCreateCredit(target.id);
        if (vc.frozen) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Target has credit freeze active.')], components:[] });
        const tier   = getCreditTier(vc.score);
        if (!tier.card) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Target score too low for a card.')], components:[] });
        if (!success) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('💻 Crack Failed').setDescription(`Couldn't bypass security. (${successRate}% chance)`)], components:[] });

        const tv   = getOrCreateUser(target.id);
        const limit= Math.floor((tv.bank||0)*(tier.limitPct||0.2)*0.5);
        const amt  = Math.floor(limit*(0.5+Math.random()*0.5));
        user.wallet += amt;
        vc.balance   = (vc.balance||0)+amt;
        if (!vc.card) { vc.card=tier.card; vc.limit=limit; }
        await adjustScore(target.id, -45, 'Fraud via Credit Cracker');
        saveUser(userId, user);
        await saveCredit(target.id, vc);
        try { const { addHeat } = require('../../utils/gangDb'); await addHeat(userId, 35, 'credit fraud'); } catch {}
        void (async () => { try { await target.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setTitle('\u{1F6A8} Fraud Alert').setDescription('Fraudulent card opened on your SSN. $' + amt.toLocaleString() + ' charged. Score -45. Freeze your credit!')] }); } catch(e){} })()
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xf5c518).setTitle('💳 Fraud Successful').setDescription(`Opened ${tier.card} on <@${target.id}>'s SSN.\n\n💰 Stolen: **${fmtMoney(amt)}** → wallet\nScore hit: **-45**`)], components:[] });
      }

      // ── CARD DRAINER ──────────────────────────────────────
      if (appId === 'card_drainer') {
        if (!target) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Specify a target.')], components:[] });
        const hc = await getOrCreateCredit(userId);
        if (!hc.ssnStolen?.[target.id]) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No SSN on file. Run SSN Scanner first.')], components:[] });
        const vc = await getOrCreateCredit(target.id);
        if (!vc.card) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Target has no card to drain.')], components:[] });
        if (!success) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('💻 Drain Failed').setDescription(`Card drain blocked. (${successRate}% chance)`)], components:[] });

        const avail  = (vc.limit||0)-(vc.balance||0);
        if (avail < 100) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Card already maxed.')], components:[] });
        user.wallet += avail;
        vc.balance  += avail;
        await adjustScore(target.id, -25, 'Card drained');
        saveUser(userId, user);
        await saveCredit(target.id, vc);
        target.send({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setTitle('Card Maxed').setDescription('Card remotely drained. $' + avail.toLocaleString() + ' taken. Score -25.')] }).catch(e => null)
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xf5c518).setTitle('💸 Card Drained').setDescription(`Drained **${fmtMoney(avail)}** from <@${target.id}>'s card. Score hit: **-25**`)], components:[] });
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

        return interaction.editReply({ embeds:[new EmbedBuilder()
          .setColor(0x2c2f73)
          .setTitle(`👁️ Intel: ${target.username}`)
          .addFields(
            { name:'💵 Wallet',   value:fmtMoney(tv?.wallet||0),                      inline:true },
            { name:'🏦 Bank',     value:fmtMoney(tv?.bank||0),                        inline:true },
            { name:'📱 Status',   value:ttier?.label||'None',                          inline:true },
            { name:'🏠 Home',     value:home?`${home.tier} · ${(home.stash||[]).length} stash`:'None', inline:true },
            { name:'🏢 Business', value:tbiz?`${tbiz.name} Lv${tbiz.level||1}`:'None', inline:true },
            { name:'🏴 Gang',     value:tgang?.name||'None',                           inline:true },
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

      return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('App function coming soon.')], components:[] });
    }
  },
};
