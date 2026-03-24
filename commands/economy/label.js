// ============================================================
// commands/entrepreneur/label.js — /label
// Record label management — sign artists, collect revenue
// ============================================================
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getBusiness: _gb } = require('../../utils/db');
const { getLabel, saveLabel, getContract, saveContract, deleteContract, calcArtistRevenue, NPC_ARTISTS, isSignedArtist } = require('../../utils/labelDb');
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

  data: new SlashCommandBuilder()
    .setName('label')
    .setDescription('🎵 Manage your record label — sign artists, collect revenue.')
    .addSubcommand(s => s.setName('roster').setDescription('View your signed artists and label stats'))
    .addSubcommand(s => s.setName('sign').setDescription('Offer a real user a recording contract')
      .addUserOption(o => o.setName('artist').setDescription('User to sign').setRequired(true))
      .addIntegerOption(o => o.setName('cut').setDescription('Artist cut % (10-50, default 30)').setRequired(false).setMinValue(10).setMaxValue(50)))
    .addSubcommand(s => s.setName('signnpc').setDescription('Browse and sign NPC artists'))
    .addSubcommand(s => s.setName('release').setDescription('Drop an artist from your label')
      .addStringOption(o => o.setName('artist_id').setDescription('Artist ID or @mention').setRequired(true)))
    .addSubcommand(s => s.setName('promote').setDescription('Promote an artist — boosts fanbase and revenue')
      .addStringOption(o => o.setName('artist_id').setDescription('Artist ID').setRequired(true))
      .addIntegerOption(o => o.setName('budget').setDescription('Promo budget from your wallet').setRequired(true).setMinValue(1000))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // Must own a Record Label business
    const biz = getBusiness(userId);
    if (!biz || biz.type !== 'record_label') {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('You need to own a **Record Label** business. Start one with `/business start type:record_label`.')
      ], ephemeral:true });
    }

    let label = getLabel(userId) || { artists:[], totalRevenue:0, lastTick:Date.now() };

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
        return {
          name,
          value:`Revenue: **${fmtMoney(rev)}/tick** · Cut: **${a.artistCut||30}%** · ${contract?.illuminatiControlled ? '🔺 Controlled' : contract?.forced ? '⚠️ Forced' : '✅ Signed'}`,
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
