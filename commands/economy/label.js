// ============================================================
// commands/entrepreneur/label.js — /label
// Record label management — sign artists, collect revenue
// ============================================================
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getBusiness: _gb } = require('../../utils/db');
const { getLabel, saveLabel, getContract, saveContract, deleteContract, calcArtistRevenue, NPC_ARTISTS, isSignedArtist } = require('../../utils/labelDb');
const { getPhone, getArtistTier } = require('../../utils/phoneDb');
const { getBusiness } = require('../../utils/bizDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();

// Pending contract offers: artistId -> { labelOwnerId, terms, expiresAt }
const _pendingContracts = {};

function requireLabel(userId) {
  const biz = getBusiness(userId);
  if (!biz || biz.type !== 'record_label') return null;
  return getLabel(userId) || { artists:[], totalRevenue:0, lastTick:Date.now() };
}

module.exports = {
  _pendingContracts,

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'artist_id') {
      const { getLabel } = require('../../utils/labelDb');
      const label = getLabel(interaction.user.id);
      const typed = focused.value.toLowerCase();
      const choices = (label?.artists||[]).map(a => ({
        name: a.isNPC ? (a.npcData?.name||a.artistId) : `@User ${a.artistId}`,
        value: a.artistId,
      })).filter(c => c.name.toLowerCase().includes(typed)).slice(0,25);
      return interaction.respond(choices.length ? choices : [{ name:'No artists on roster', value:'__none__' }]);
    }
  },

  data: new SlashCommandBuilder()
    .setName('label')
    .setDescription('🎵 Manage your record label — sign artists, collect revenue.')
    .addSubcommand(s => s.setName('roster').setDescription('View your signed artists and label stats'))
    .addSubcommand(s => s.setName('sign').setDescription('Offer a real user a recording contract')
      .addUserOption(o => o.setName('artist').setDescription('User to sign').setRequired(true))
      .addIntegerOption(o => o.setName('cut').setDescription('Artist cut % (10-50, default 30)').setRequired(false).setMinValue(10).setMaxValue(50)))
    .addSubcommand(s => s.setName('signnpc').setDescription('Browse and sign NPC artists'))
    .addSubcommand(s => s.setName('release').setDescription('Drop an artist from your label')
      .addStringOption(o => o.setName('artist_id').setDescription('Artist ID').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('promote').setDescription('Promote an artist — boosts fanbase and revenue')
      .addStringOption(o => o.setName('artist_id').setDescription('Artist ID').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('budget').setDescription('Promo budget from your wallet').setRequired(true).setMinValue(1000))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // Must own a Record Label business — find it specifically
    const allBiz = getBusinesses(userId);
    const biz    = allBiz.find(b => b.type === 'recordlabel' || b.type === 'record_label');
    if (!biz) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('You need to own a **🎵 Record Label** business. Start one with `/business start type:recordlabel`.')
      ], ephemeral:true });
    }

    let label = getLabel(userId) || { artists:[], totalRevenue:0, lastTick:Date.now() };


    // ── INVEST IN ARTIST ─────────────────────────────────────
    if (sub === 'invest') {
      const artistId = interaction.options.getString('artist_id');
      const action   = interaction.options.getString('action');

      const artistEntry = label.artists.find(a => a.artistId === artistId);
      if (!artistEntry) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Artist not on your roster. Use `/label roster` to view signed artists.')], ephemeral:true });

      const isNPC  = artistEntry.isNPC;
      const npc    = artistEntry.npcData;
      const name   = isNPC ? `${npc?.emoji||'🎤'} ${npc?.name||artistId}` : `<@${artistId}>`;

      const INVESTMENTS = {
        show:      { cost:2000,  desc:'Booked a live show',        fanboost:0.08, hypeboost:500,   fameBoost:300,  revenueBoost:0     },
        interview: { cost:5000,  desc:'TV interview aired',         fanboost:0.05, hypeboost:1200,  fameBoost:800,  revenueBoost:0.05  },
        deal:      { cost:8000,  desc:'Brand deal secured',         fanboost:0.03, hypeboost:400,   fameBoost:200,  revenueBoost:0.15  },
        drop:      { cost:3000,  desc:'New record dropped',         fanboost:0.15, hypeboost:2000,  fameBoost:600,  revenueBoost:0     },
        shoutout:  { cost:6000,  desc:'Influencer shoutout went viral', fanboost:0.20, hypeboost:5000, fameBoost:1500, revenueBoost:0   },
        tour:      { cost:20000, desc:'World tour wrapped',          fanboost:0.40, hypeboost:15000, fameBoost:5000, revenueBoost:0.20 },
        merch:     { cost:4000,  desc:'Merch line launched',         fanboost:0.02, hypeboost:200,   fameBoost:100,  revenueBoost:0.10 },
        podcast:   { cost:1500,  desc:'Podcast appearance dropped',  fanboost:0.03, hypeboost:300,   fameBoost:150,  revenueBoost:0     },
      };

      const inv = INVESTMENTS[action];
      if (!inv) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Unknown investment type.')], ephemeral:true });

      const user2 = getOrCreateUser(userId);
      if (user2.wallet < inv.cost) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`**${inv.desc}** costs **${fmtMoney(inv.cost)}**. You have **${fmtMoney(user2.wallet)}**.`)
      ], ephemeral:true });

      user2.wallet -= inv.cost;
      saveUser(userId, user2);

      // Apply boosts to NPC artist data
      if (isNPC && npc) {
        const oldFanbase = npc.fanbase || 10000;
        npc.fanbase    = Math.floor(oldFanbase * (1 + inv.fanboost));
        npc.hype       = Math.min(100, (npc.hype||50) + Math.floor(inv.hypeboost / 1000));
        // Revenue boost for deal/tour/merch
        if (inv.revenueBoost > 0) {
          npc.weeklyRate = Math.floor((npc.weeklyRate||500) * (1 + inv.revenueBoost));
        }
        artistEntry.npcData = npc;

        // Update contract
        const contract2 = getContract(artistId);
        if (contract2) {
          contract2.npcData = npc;
          await saveContract(artistId, contract2);
        }
        await saveLabel(userId, label);

        // If user artist (not NPC), boost their phone career
      } else if (!isNPC) {
        try {
          const { getPhone, savePhone: sp2, getArtistTier } = require('../../utils/phoneDb');
          const p2 = getPhone(artistId);
          if (p2) {
            if (!p2.artistCareer) p2.artistCareer = { fame:0, tier:'unsigned' };
            p2.artistCareer.fame = (p2.artistCareer.fame||0) + inv.fameBoost;
            p2.hype              = (p2.hype||0) + inv.hypeboost;
            p2.followers         = Math.floor((p2.followers||0) * (1 + inv.fanboost));
            p2.artistCareer.tier = getArtistTier(p2.artistCareer.fame).id;
            await sp2(artistId, p2);
            // DM the artist
            interaction.client.users.fetch(artistId).then(u2 => u2.send({ embeds:[new EmbedBuilder()
              .setColor(0xf5c518)
              .setTitle(`🎤 ${action === 'tour' ? '🌍 World Tour' : action === 'shoutout' ? '📣 Shoutout' : inv.desc}!`)
              .setDescription(`Your label invested **${fmtMoney(inv.cost)}** in your career!

+${inv.fameBoost.toLocaleString()} fame · +${inv.hypeboost.toLocaleString()} hype · +${Math.round(inv.fanboost*100)}% followers`)
            ]}).catch(()=>null)).catch(()=>null);
          }
        } catch {}
      }

      const newFanbase = isNPC ? (npc?.fanbase||0) : 0;
      const fanDiff    = isNPC ? Math.floor((npc?.fanbase||0) - (npc?.fanbase||0)/(1+inv.fanboost)) : 0;

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`✅ ${inv.desc}!`)
        .setDescription(`Invested **${fmtMoney(inv.cost)}** into **${name}**'s career.`)
        .addFields(
          { name:'👥 Fanbase Boost', value:`+${Math.round(inv.fanboost*100)}%${isNPC ? ` → ${(newFanbase/1000).toFixed(0)}K` : ''}`, inline:true },
          { name:'✨ Hype Boost',    value:`+${inv.hypeboost.toLocaleString()}`,              inline:true },
          { name:'🎵 Fame Boost',    value:`+${inv.fameBoost.toLocaleString()}`,              inline:true },
          ...(inv.revenueBoost > 0 ? [{ name:'💰 Revenue Boost', value:`+${Math.round(inv.revenueBoost*100)}% weekly rate`, inline:true }] : []),
          { name:'💵 Your Wallet',  value:fmtMoney(user2.wallet), inline:true },
        )
        .setFooter({ text:'Revenue from this investment pays out next label tick · 15 min' })
      ]});
    }

        // ── ROSTER ────────────────────────────────────────────────
    if (sub === 'roster') {
      if (!label.artists.length) return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎵 ${biz.name} — Roster`)
        .setDescription('No artists signed yet.\n\nUse `/label sign @user` or `/label signnpc` to build your roster.')
      ]});

      const fields = label.artists.map(a => {
        const contract = getContract(a.artistId);
        const rev      = contract ? calcArtistRevenue(contract) : 0;
        const name     = a.isNPC ? `${a.npcData?.emoji||'🎤'} ${a.npcData?.name||a.artistId}` : `<@${a.artistId}>`;
        // Artist tier
        let tierLabel = '🎙️ Unsigned';
        if (!a.isNPC) {
          const phone = getPhone(a.artistId);
          if (phone?.artistCareer) tierLabel = getArtistTier(phone.artistCareer.fame||0).label;
        } else if (a.npcData) {
          const fakeFame = (a.npcData.fanbase||0) / 50;
          tierLabel = getArtistTier(fakeFame).label;
        }
        const badges = [
          contract?.isPlant              ? '🌱 Plant' : '',
          contract?.illuminatiControlled ? '🔺 Controlled' : '',
          contract?.forced               ? '⚠️ Forced' : '',
        ].filter(Boolean).join(' ') || '✅ Signed';
        return {
          name: `${name} — ${tierLabel}`,
          value:`Rev: **${fmtMoney(rev)}/tick** · Cut: **${a.artistCut||30}%** · ${badges}`,
          inline: false,
        };
      });

      const totalPerTick = label.artists.reduce((s,a) => {
        const c = getContract(a.artistId);
        return s + (c ? Math.floor(calcArtistRevenue(c) * (1-(a.artistCut||30)/100)) : 0);
      }, 0);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`🎵 ${biz.name} — Roster (${label.artists.length} artists)`)
        .setDescription(`Label revenue: **${fmtMoney(totalPerTick)}/tick** · Total earned: **${fmtMoney(label.totalRevenue||0)}**`)
        .addFields(...fields.slice(0,10))
        .setFooter({ text:'Revenue pays every 15 minutes · Use /label promote to boost an artist' })
      ]});
    }

    // ── SIGN (real user) ──────────────────────────────────────
    if (sub === 'sign') {
      const target = interaction.options.getUser('artist');
      const cut    = interaction.options.getInteger('cut') || 30;

      if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't sign yourself.")], ephemeral:true });
      if (isSignedArtist(target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> is already signed to a label.`)], ephemeral:true });

      // Must have Celebrity+ status
      const { getPhone, STATUS_TIERS, getStatusTier } = require('../../utils/phoneDb');
      const phone = getPhone(target.id);
      const tier  = getStatusTier(phone?.status||0);
      if ((tier?.level||0) < 3) { // level 3 = Influencer+
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`<@${target.id}> needs at least **🔥 Influencer** status to sign with a label. They are currently: **${tier?.label||'Newcomer'}**`)
        ], ephemeral:true });
      }

      _pendingContracts[target.id] = { labelOwnerId:userId, labelName:biz.name, cut, expiresAt:Date.now()+10*60*1000 };

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`label_sign_accept_${userId}`).setLabel(`✅ Sign with ${biz.name} (${cut}% cut)`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`label_sign_decline_${userId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Secondary),
      );

      try {
        await target.send({ embeds:[new EmbedBuilder()
          .setColor(0xf5c518)
          .setTitle('🎵 Recording Contract Offer')
          .setDescription(`**${biz.name}** wants to sign you!\n\n**Your cut:** ${cut}% of all music revenue you generate\n**Label gets:** ${100-cut}%\n\n⏱️ Expires in 10 minutes.`)
        ], components:[row] });
      } catch {
        delete _pendingContracts[target.id];
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't DM that user.")], ephemeral:true });
      }

      setTimeout(() => { delete _pendingContracts[target.id]; }, 10*60*1000);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0xf5c518)
        .setDescription(`📨 Contract offer sent to <@${target.id}> — ${cut}% artist cut.`)
      ], ephemeral:true });
    }

    // ── SIGN NPC ──────────────────────────────────────────────
    if (sub === 'signnpc') {
      const available = NPC_ARTISTS.filter(a => {
        // Check not already signed to this label
        return !label.artists.some(la => la.artistId === a.id);
      });

      if (!available.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('All NPC artists are already on your roster.')], ephemeral:true });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('label_npc_select')
        .setPlaceholder('Browse and sign an NPC artist...')
        .addOptions(available.map(a => new StringSelectMenuOptionBuilder()
          .setLabel(`${a.emoji} ${a.name}`)
          .setDescription(`Talent: ${a.talent} · Hype: ${a.hype} · Fanbase: ${(a.fanbase/1000).toFixed(0)}K · ~${fmtMoney(a.weeklyRate)}/week`)
          .setValue(a.id)
        ));

      const lines = available.map(a =>
        `${a.emoji} **${a.name}** — Talent: ${a.talent} · Hype: ${a.hype} · Fanbase: ${(a.fanbase/1000).toFixed(0)}K · *${a.image}* image\nEst. revenue: **${fmtMoney(a.weeklyRate)}/week**`
      ).join('\n\n');

      await interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎤 NPC Artist Roster')
        .setDescription(lines)
        .setFooter({ text:'Select an artist to sign them immediately (no signing fee)' })
      ], components:[new ActionRowBuilder().addComponents(menu)] });

      const msg  = await interaction.fetchReply();
      const coll = msg.createMessageComponentCollector({ filter:i=>i.user.id===userId, time:60_000, max:1 });

      coll.on('collect', async si => {
        const npcId  = si.values[0];
        const npc    = NPC_ARTISTS.find(a=>a.id===npcId);
        if (!npc) return si.update({ content:'Not found.', components:[] });

        const contract = { labelOwnerId:userId, artistId:npcId, isNPC:true, npcData:npc, artistCut:20, signedAt:Date.now(), illuminatiControlled:false, forced:false };
        await saveContract(npcId, contract);

        const fresh = getLabel(userId) || { artists:[], totalRevenue:0, lastTick:Date.now() };
        fresh.artists.push({ artistId:npcId, isNPC:true, npcData:npc, artistCut:20 });
        await saveLabel(userId, fresh);

        await si.update({ embeds:[new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle(`${npc.emoji} ${npc.name} Signed!`)
          .setDescription(`**${npc.name}** is now on your roster.\n\nTalent: ${npc.talent} · Hype: ${npc.hype} · Fanbase: ${(npc.fanbase/1000).toFixed(0)}K\n\nRevenue starts flowing next tick. Use \`/label promote\` to grow their fanbase.`)
        ], components:[] });
      });

      return;
    }

    // ── RELEASE ───────────────────────────────────────────────
    if (sub === 'release') {
      const artistId = interaction.options.getString('artist_id').replace(/[<@!>]/g,'');
      const idx      = label.artists.findIndex(a => a.artistId === artistId);
      if (idx === -1) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Artist not on your roster.')], ephemeral:true });

      const artist = label.artists[idx];
      label.artists.splice(idx, 1);
      await deleteContract(artistId);
      await saveLabel(userId, label);

      const name = artist.isNPC ? artist.npcData?.name : `<@${artistId}>`;
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888)
        .setDescription(`🎤 **${name}** has been released from ${biz.name}.`)
      ]});
    }

    // ── PROMOTE ───────────────────────────────────────────────
    if (sub === 'promote') {
      const artistId = interaction.options.getString('artist_id');
      const budget   = interaction.options.getInteger('budget');
      const artist   = label.artists.find(a => a.artistId === artistId);
      if (!artist) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Artist not on your roster.')], ephemeral:true });

      const user = getOrCreateUser(userId);
      if (user.wallet < budget) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Need ${fmtMoney(budget)} in wallet.`)], ephemeral:true });

      user.wallet -= budget;
      saveUser(userId, user);

      // Promo boosts fanbase and hype
      const contract = getContract(artistId);
      if (contract?.npcData) {
        const boostFanbase = Math.floor(budget * 0.5);
        const boostHype    = Math.floor(budget / 10000);
        contract.npcData.fanbase += boostFanbase;
        contract.npcData.hype    = Math.min(100, (contract.npcData.hype||50) + boostHype);
        await saveContract(artistId, contract);
      }

      const name = artist.isNPC ? artist.npcData?.name : `<@${artistId}>`;
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('📣 Promotion Campaign Launched')
        .setDescription(`**${name}** promoted with **${fmtMoney(budget)}**.\n\n+${Math.floor(budget*0.5).toLocaleString()} fanbase · Hype boosted.\n\nRevenue increase will reflect next tick.`)
      ]});
    }
  },
};
