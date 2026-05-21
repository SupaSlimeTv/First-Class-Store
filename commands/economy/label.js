// ============================================================
// commands/economy/label.js — /label
// Record label management — sign artists, collect revenue
// ============================================================
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const {
  getLabel, saveLabel, getContract, saveContract, deleteContract,
  calcArtistRevenue, NPC_ARTISTS, isSignedArtist, CONTRACT_TYPES, TEAM_ROLES,
} = require('../../utils/labelDb');
const { getPhone, getArtistTier, getStatusTier, STATUS_TIERS } = require('../../utils/phoneDb');
const { getBusinesses } = require('../../utils/bizDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const fmtMoney = n => '$' + Math.round(n).toLocaleString();

// In-memory pending contract offers: artistId -> { labelOwnerId, labelName, cut, type, advance, expiresAt }
const _pendingContracts = {};

function getNPCAdvance(npc) {
  if (npc.weeklyRate >= 8000) return 100000;
  if (npc.weeklyRate >= 4000) return 50000;
  if (npc.weeklyRate >= 1500) return 20000;
  return 5000;
}

function getAlbumCost(contract) {
  const fanbase = contract.npcData?.fanbase || 10000;
  if (fanbase >= 250000) return 100000;
  if (fanbase >= 100000) return 50000;
  if (fanbase >= 25000)  return 25000;
  return 10000;
}

function buildNewContract(overrides) {
  return {
    type: 'standard', artistCut: 30, advance: 0, recouped: 0,
    team: [], lastAlbum: null, albumBoostUntil: null,
    charting: false, chartingUntil: null,
    signedAt: Date.now(), illuminatiControlled: false, forced: false, isPlant: false,
    ...overrides,
  };
}

module.exports = {
  _pendingContracts,

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'artist_id') {
      const label  = getLabel(interaction.user.id);
      const typed  = focused.value.toLowerCase();
      const choices = (label?.artists || []).map(a => ({
        name:  a.isNPC ? `${a.npcData?.emoji || '🎤'} ${a.npcData?.name || a.artistId}` : `User ${a.artistId}`,
        value: a.artistId,
      })).filter(c => c.name.toLowerCase().includes(typed)).slice(0, 25);
      return interaction.respond(choices.length ? choices : [{ name: 'No artists on roster', value: '__none__' }]);
    }
  },

  data: new SlashCommandBuilder()
    .setName('label')
    .setDescription('🎵 Manage your record label — sign artists, drop albums, collect revenue.')
    .addSubcommand(s => s.setName('roster').setDescription('View your signed artists and label stats'))
    .addSubcommand(s => s.setName('sign').setDescription('Offer a real user a recording contract')
      .addUserOption(o => o.setName('artist').setDescription('User to sign').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Contract type').setRequired(false)
        .addChoices(
          { name: '📄 Standard — clean deal, optional advance',           value: 'standard'    },
          { name: '🛠️ Development — label invests, 25% team discount',    value: 'development' },
          { name: '🔄 360 Deal — all income streams, +20% revenue bonus', value: 'deal360'     },
        ))
      .addIntegerOption(o => o.setName('cut').setDescription('Artist cut % (10–50, default 30)').setRequired(false).setMinValue(10).setMaxValue(50))
      .addIntegerOption(o => o.setName('advance').setDescription('Upfront advance paid to artist from your wallet').setRequired(false).setMinValue(0)))
    .addSubcommand(s => s.setName('signnpc').setDescription('Browse and sign NPC artists to your label'))
    .addSubcommand(s => s.setName('release').setDescription('Drop an artist from your label')
      .addStringOption(o => o.setName('artist_id').setDescription('Artist to release').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('promote').setDescription('Promote an artist — boosts fanbase and revenue')
      .addStringOption(o => o.setName('artist_id').setDescription('Artist to promote').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('budget').setDescription('Promo budget from your wallet').setRequired(true).setMinValue(1000)))
    .addSubcommand(s => s.setName('team').setDescription('Hire or fire team members for a signed artist')
      .addStringOption(o => o.setName('artist_id').setDescription('Artist on your roster').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('album').setDescription('Drop an album — big hype spike and 24h revenue boost')
      .addStringOption(o => o.setName('artist_id').setDescription('Artist on your roster').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('collect').setDescription('Collect all accumulated label revenue'))
    .addSubcommand(s => s.setName('contract').setDescription('View the full contract details for an artist')
      .addStringOption(o => o.setName('artist_id').setDescription('Artist on your roster').setRequired(true).setAutocomplete(true))),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    const allBiz = getBusinesses(userId);
    const biz    = allBiz.find(b => b.type === 'recordlabel' || b.type === 'record_label');
    if (!biz) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription('You need a **🎵 Record Label** business. Start one with `/business start type:recordlabel`.')
    ], ephemeral: true });

    let label = getLabel(userId) || { artists: [], totalRevenue: 0, pendingRevenue: 0, lastTick: Date.now() };
    if (!label.pendingRevenue) label.pendingRevenue = 0;

    // ── ROSTER ────────────────────────────────────────────────
    if (sub === 'roster') {
      if (!label.artists.length) return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎵 ${biz.name} — Roster`)
        .setDescription('No artists signed yet.\n\nUse `/label signnpc` or `/label sign @user` to build your roster.\nUse `/label collect` to cash out your pending revenue.')
      ]});

      const fields = label.artists.map(a => {
        const contract  = getContract(a.artistId);
        const rev       = contract ? calcArtistRevenue(contract) : 0;
        const advance   = contract?.advance  || 0;
        const recouped  = contract?.recouped || 0;
        const isRecoup  = advance > recouped;
        const labelRev  = isRecoup ? rev : Math.floor(rev * (1 - (contract?.artistCut || 30) / 100));
        const name      = a.isNPC ? `${a.npcData?.emoji || '🎤'} ${a.npcData?.name || a.artistId}` : `<@${a.artistId}>`;
        const ct        = CONTRACT_TYPES[contract?.type || 'standard'];

        let tierLabel = '🎙️ Unsigned';
        if (!a.isNPC) {
          const phone = getPhone(a.artistId);
          if (phone?.artistCareer) tierLabel = getArtistTier(phone.artistCareer.fame || 0).label;
        } else if (a.npcData) {
          tierLabel = getArtistTier((a.npcData.fanbase || 0) / 50).label;
        }

        const teamIcons = (contract?.team || []).map(r => TEAM_ROLES[r]?.emoji || '').join('');
        const badges = [
          contract?.charting                                                      ? '📊 **Charting!**'    : '',
          contract?.albumBoostUntil && Date.now() < contract.albumBoostUntil      ? '🎵 **Album Out!**'   : '',
          isRecoup                                                                ? `⏳ Recoup: $${recouped.toLocaleString()}/$${advance.toLocaleString()}` : advance > 0 ? '✅ Recouped' : '',
          contract?.illuminatiControlled                                          ? '🔺 Controlled'       : '',
        ].filter(Boolean).join(' · ');

        return {
          name:  `${name} — ${tierLabel}`,
          value: [
            `${ct?.emoji} ${ct?.name} · **${contract?.artistCut || 30}%** artist cut`,
            `Label earns: **${fmtMoney(labelRev)}/tick**${teamIcons ? ` · ${teamIcons}` : ''}`,
            badges,
          ].filter(Boolean).join('\n'),
          inline: false,
        };
      });

      const totalPerTick = label.artists.reduce((s, a) => {
        const c = getContract(a.artistId);
        if (!c) return s;
        const rev = calcArtistRevenue(c);
        const isRecouping = (c.advance || 0) > (c.recouped || 0);
        return s + (isRecouping ? rev : Math.floor(rev * (1 - (c.artistCut || 30) / 100)));
      }, 0);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`🎵 ${biz.name} — Roster (${label.artists.length} artist${label.artists.length !== 1 ? 's' : ''})`)
        .setDescription(`💰 **Pending:** ${fmtMoney(label.pendingRevenue || 0)} · Total earned: ${fmtMoney(label.totalRevenue || 0)}`)
        .addFields(
          ...fields.slice(0, 10),
          { name: '📊 Label Revenue', value: `**${fmtMoney(totalPerTick)}/tick** (every 15 min) · Use \`/label collect\` to cash out`, inline: false },
        )
      ]});
    }

    // ── COLLECT ───────────────────────────────────────────────
    if (sub === 'collect') {
      const pending = Math.floor(label.pendingRevenue || 0);
      if (pending < 1) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('No pending revenue yet. Revenue accumulates every 15 minutes — come back after your artists earn.')
      ], ephemeral: true });

      const user    = getOrCreateUser(userId);
      user.wallet  += pending;
      saveUser(userId, user);
      label.pendingRevenue = 0;
      await saveLabel(userId, label);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle('💰 Revenue Collected!')
        .setDescription(`Collected **${fmtMoney(pending)}** from **${biz.name}**.`)
        .addFields(
          { name: '💵 Wallet',      value: fmtMoney(user.wallet),            inline: true },
          { name: '🎤 Artists',     value: `${label.artists.length}`,         inline: true },
          { name: '📊 Total Earned',value: fmtMoney(label.totalRevenue || 0), inline: true },
        )
        .setFooter({ text: 'Revenue ticks every 15 min · /label collect to cash out anytime' })
      ]});
    }

    // ── SIGN (real user) ──────────────────────────────────────
    if (sub === 'sign') {
      const target  = interaction.options.getUser('artist');
      const cut     = interaction.options.getInteger('cut') || 30;
      const type    = interaction.options.getString('type') || 'standard';
      const advance = interaction.options.getInteger('advance') || 0;

      if (target.id === userId)          return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't sign yourself.")], ephemeral: true });
      if (isSignedArtist(target.id))     return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> is already signed to a label.`)], ephemeral: true });
      if (label.artists.length >= 12)    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Roster is full (12 artists max).')], ephemeral: true });

      const phone      = getPhone(target.id);
      const statusTier = getStatusTier(phone?.status || 0);
      const tierIdx    = STATUS_TIERS.findIndex(t => t.id === statusTier?.id);
      if (tierIdx < 3) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`<@${target.id}> needs at least **🔥 Influencer** status to sign. They're currently: **${statusTier?.label || 'Newcomer'}**`)
      ], ephemeral: true });

      if (advance > 0) {
        const owner = getOrCreateUser(userId);
        if (owner.wallet < advance) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`You need **${fmtMoney(advance)}** to pay this advance. You have **${fmtMoney(owner.wallet)}**.`)
        ], ephemeral: true });
        owner.wallet -= advance;
        saveUser(userId, owner);
        const artistUser    = getOrCreateUser(target.id);
        artistUser.wallet  += advance;
        saveUser(target.id, artistUser);
      }

      const ct = CONTRACT_TYPES[type] || CONTRACT_TYPES.standard;
      _pendingContracts[target.id] = { labelOwnerId: userId, labelName: biz.name, cut, type, advance, expiresAt: Date.now() + 10 * 60 * 1000 };
      setTimeout(() => { delete _pendingContracts[target.id]; }, 10 * 60 * 1000);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`label_sign_accept_${userId}`).setLabel(`✅ Sign with ${biz.name}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`label_sign_decline_${userId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Secondary),
      );

      try {
        await target.send({ embeds: [new EmbedBuilder()
          .setColor(0xf5c518)
          .setTitle('🎵 Recording Contract Offer')
          .setDescription(
            `**${biz.name}** wants to sign you!\n\n` +
            `**${ct.emoji} ${ct.name}**\n${ct.desc}\n\n` +
            `**Your cut:** ${cut}% of music revenue you generate\n` +
            `**Label keeps:** ${100 - cut}%\n` +
            (advance > 0 ? `**Advance paid to you:** ${fmtMoney(advance)} *(must be recouped before your cut kicks in)*\n` : '') +
            `\n⏱️ Expires in 10 minutes.`
          )
        ], components: [row] });
      } catch {
        if (advance > 0) {
          const owner = getOrCreateUser(userId);
          owner.wallet += advance;
          saveUser(userId, owner);
          const artistUser    = getOrCreateUser(target.id);
          artistUser.wallet   = Math.max(0, artistUser.wallet - advance);
          saveUser(target.id, artistUser);
        }
        delete _pendingContracts[target.id];
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't DM that user. They may have DMs disabled.")], ephemeral: true });
      }

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('📨 Contract Offer Sent')
        .setDescription(
          `Offer sent to <@${target.id}>.\n\n` +
          `${ct.emoji} **${ct.name}** · ${cut}% artist cut` +
          (advance > 0 ? ` · ${fmtMoney(advance)} advance paid` : '')
        )
      ], ephemeral: true });
    }

    // ── SIGN NPC ──────────────────────────────────────────────
    if (sub === 'signnpc') {
      if (label.artists.length >= 12) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Roster is full (12 artists max). Release someone first.')], ephemeral: true });

      const available = NPC_ARTISTS.filter(a => !label.artists.some(la => la.artistId === a.id));
      if (!available.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('All NPC artists are already on your roster.')], ephemeral: true });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('label_npc_select')
        .setPlaceholder('Select an artist to sign...')
        .addOptions(available.map(a => {
          const adv = getNPCAdvance(a);
          return new StringSelectMenuOptionBuilder()
            .setLabel(`${a.emoji} ${a.name}`)
            .setDescription(`Advance: ${fmtMoney(adv)} · Talent: ${a.talent} · ${(a.fanbase / 1000).toFixed(0)}K fans · ~${fmtMoney(a.weeklyRate)}/wk`)
            .setValue(a.id);
        }));

      const lines = available.map(a => {
        const adv      = getNPCAdvance(a);
        const tierLabel = getArtistTier(a.fanbase / 50).label;
        const imageTag  = { clean: '✅ Clean', controversial: '🔥 Controversial', iconic: '👑 Iconic' }[a.image] || a.image;
        return `${a.emoji} **${a.name}** — ${tierLabel}\nTalent: **${a.talent}** · Hype: **${a.hype}** · Fans: **${(a.fanbase / 1000).toFixed(0)}K** · ${imageTag}\nEst. **${fmtMoney(a.weeklyRate)}/week** · Advance required: **${fmtMoney(adv)}**`;
      }).join('\n\n');

      await interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎤 Sign an NPC Artist')
        .setDescription(lines)
        .setFooter({ text: 'Advance deducted from your wallet · Artist cut: 20% after recoupment' })
      ], components: [new ActionRowBuilder().addComponents(menu)] });

      const msg  = await interaction.fetchReply();
      const coll = msg.createMessageComponentCollector({ filter: i => i.user.id === userId, time: 60_000, max: 1 });

      coll.on('collect', async si => {
        const npcId = si.values[0];
        const npc   = NPC_ARTISTS.find(a => a.id === npcId);
        if (!npc) return si.update({ content: 'NPC not found.', components: [] });

        const adv   = getNPCAdvance(npc);
        const owner = getOrCreateUser(userId);
        if (owner.wallet < adv) return si.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`You need **${fmtMoney(adv)}** to sign **${npc.name}**. You have **${fmtMoney(owner.wallet)}**.`)
        ], components: [] });

        owner.wallet -= adv;
        saveUser(userId, owner);

        const contract = buildNewContract({
          labelOwnerId: userId, artistId: npcId, isNPC: true, npcData: { ...npc },
          advance: adv, artistCut: 20,
        });
        await saveContract(npcId, contract);

        const fresh = getLabel(userId) || { artists: [], totalRevenue: 0, pendingRevenue: 0 };
        fresh.artists.push({ artistId: npcId, isNPC: true, npcData: { ...npc }, artistCut: 20 });
        await saveLabel(userId, fresh);

        await si.update({ embeds: [new EmbedBuilder()
          .setColor(COLORS.SUCCESS)
          .setTitle(`${npc.emoji} ${npc.name} Signed!`)
          .setDescription(
            `**${npc.name}** is now on your roster.\n\n` +
            `Talent: **${npc.talent}** · Hype: **${npc.hype}** · Fans: **${(npc.fanbase / 1000).toFixed(0)}K**\n\n` +
            `💰 Advance paid: **${fmtMoney(adv)}** — you earn 100% until recouped, then **20%** goes to artist\n\n` +
            `Next steps:\n• \`/label team\` — hire a Manager, Publicist, or Producer\n• \`/label album\` — drop a project for a 3× revenue spike\n• \`/label promote\` — spend to grow their fanbase`
          )
        ], components: [] });
      });
      return;
    }

    // ── TEAM ──────────────────────────────────────────────────
    if (sub === 'team') {
      const artistId = interaction.options.getString('artist_id');
      if (artistId === '__none__') return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No artists on your roster.')], ephemeral: true });

      const contract = getContract(artistId);
      if (!contract || contract.labelOwnerId !== userId) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Artist not on your roster.')], ephemeral: true });

      const isDev    = contract.type === 'development';
      const roleIds  = Object.keys(TEAM_ROLES);

      const makeTeamEmbed = (con, footer = '') => {
        const aName = con.isNPC ? `${con.npcData?.emoji || '🎤'} ${con.npcData?.name || artistId}` : `<@${artistId}>`;
        const lines = roleIds.map(rid => {
          const role  = TEAM_ROLES[rid];
          const hired = (con.team || []).includes(rid);
          const wkCost = isDev ? Math.floor(role.weeklyCost * 0.75) : role.weeklyCost;
          return `${role.emoji} **${role.name}** ${hired ? '✅' : '❌'}\n${role.desc}\nWeekly cost: **${fmtMoney(wkCost)}** · Hire fee: **${fmtMoney(wkCost * 4)}** (4 wks upfront)`;
        }).join('\n\n');
        return new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`👥 ${aName} — Team`)
          .setDescription(lines + (isDev ? '\n\n*🛠️ Development Deal: 25% team discount applied*' : ''))
          .setFooter({ text: footer || 'Team costs auto-deducted from revenue each tick' });
      };

      const makeButtons = (team) => {
        const rows  = [];
        const hired = roleIds.filter(r =>  team.includes(r));
        const free  = roleIds.filter(r => !team.includes(r));
        if (free.length)  rows.push(new ActionRowBuilder().addComponents(free.map(r => new ButtonBuilder().setCustomId(`label_team_hire_${artistId}_${r}`).setLabel(`Hire ${TEAM_ROLES[r].name}`).setStyle(ButtonStyle.Success))));
        if (hired.length) rows.push(new ActionRowBuilder().addComponents(hired.map(r => new ButtonBuilder().setCustomId(`label_team_fire_${artistId}_${r}`).setLabel(`Fire ${TEAM_ROLES[r].name}`).setStyle(ButtonStyle.Danger))));
        return rows;
      };

      await interaction.reply({ embeds: [makeTeamEmbed(contract)], components: makeButtons(contract.team || []) });

      const msg       = await interaction.fetchReply();
      const collector = msg.createMessageComponentCollector({ filter: i => i.user.id === userId, time: 60_000 });

      collector.on('collect', async i => {
        const parts  = i.customId.split('_');
        const action = parts[2];
        const roleId = parts[parts.length - 1];
        const role   = TEAM_ROLES[roleId];
        if (!role) return i.reply({ content: 'Unknown role.', ephemeral: true });

        const fresh = getContract(artistId);
        if (!fresh) return i.reply({ content: 'Contract not found.', ephemeral: true });
        fresh.team = fresh.team || [];

        if (action === 'hire') {
          if (fresh.team.includes(roleId)) return i.reply({ content: 'Already hired.', ephemeral: true });
          const isDevelopment = fresh.type === 'development';
          const wkCost   = isDevelopment ? Math.floor(role.weeklyCost * 0.75) : role.weeklyCost;
          const upfront  = wkCost * 4;
          const owner    = getOrCreateUser(userId);
          if (owner.wallet < upfront) return i.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
            .setDescription(`Need **${fmtMoney(upfront)}** (4 weeks upfront) to hire ${role.name}. You have **${fmtMoney(owner.wallet)}**.`)
          ], components: makeButtons(fresh.team) });
          owner.wallet -= upfront;
          saveUser(userId, owner);
          fresh.team.push(roleId);
        } else {
          fresh.team = fresh.team.filter(r => r !== roleId);
        }

        await saveContract(artistId, fresh);
        const footerMsg = action === 'hire' ? `${role.emoji} ${role.name} hired!` : `${role.emoji} ${role.name} fired.`;
        await i.update({ embeds: [makeTeamEmbed(fresh, footerMsg)], components: makeButtons(fresh.team) });
      });
      return;
    }

    // ── ALBUM ──────────────────────────────────────────────────
    if (sub === 'album') {
      const artistId = interaction.options.getString('artist_id');
      if (artistId === '__none__') return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No artists on your roster.')], ephemeral: true });

      const contract = getContract(artistId);
      if (!contract || contract.labelOwnerId !== userId) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Artist not on your roster.')], ephemeral: true });

      if (contract.albumBoostUntil && Date.now() < contract.albumBoostUntil) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Album boost still active — expires <t:${Math.floor(contract.albumBoostUntil / 1000)}:R>.`)
      ], ephemeral: true });

      if (contract.lastAlbum && Date.now() - contract.lastAlbum < 30 * 24 * 60 * 60 * 1000) {
        const next = Math.floor((contract.lastAlbum + 30 * 24 * 60 * 60 * 1000) / 1000);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`Next album available <t:${next}:R>. Artists need time between drops.`)
        ], ephemeral: true });
      }

      const cost  = getAlbumCost(contract);
      const aName = contract.isNPC ? `${contract.npcData?.emoji || '🎤'} ${contract.npcData?.name || artistId}` : `<@${artistId}>`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('label_album_confirm').setLabel(`🎵 Drop Album (${fmtMoney(cost)})`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('label_album_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎵 Drop an Album — ${aName}`)
        .setDescription(
          `**Production Cost:** ${fmtMoney(cost)}\n` +
          `**Revenue Boost:** 3× for 24 hours\n` +
          `**Hype Spike:** +20 hype\n` +
          `**Cooldown:** 30 days\n\n` +
          `Ready to drop?`
        )
      ], components: [row] });

      const msg = await interaction.fetchReply();
      const i   = await msg.awaitMessageComponent({ filter: i => i.user.id === userId, time: 30_000 }).catch(() => null);
      if (!i)                               return interaction.editReply({ components: [] });
      if (i.customId === 'label_album_cancel') return i.update({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription('Album drop cancelled.')], components: [] });

      const owner = getOrCreateUser(userId);
      if (owner.wallet < cost) return i.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`Need **${fmtMoney(cost)}** to produce this album. You have **${fmtMoney(owner.wallet)}**.`)
      ], components: [] });

      owner.wallet -= cost;
      saveUser(userId, owner);

      const fresh = getContract(artistId);
      fresh.lastAlbum      = Date.now();
      fresh.albumBoostUntil = Date.now() + 24 * 60 * 60 * 1000;
      if (fresh.npcData) fresh.npcData.hype = Math.min(100, (fresh.npcData.hype || 50) + 20);
      await saveContract(artistId, fresh);

      return i.update({ embeds: [new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`🎵 Album Dropped — ${aName}`)
        .setDescription(
          `A new project just hit the streets!\n\n` +
          `🔥 **3× revenue boost** active for **24 hours**\n` +
          `📈 Artist hype: **+20**\n` +
          `💸 Production cost: **${fmtMoney(cost)}**\n\n` +
          `Use \`/label promote\` to amplify the rollout!`
        )
        .setFooter({ text: 'Next album available in 30 days · /label collect to grab earnings' })
      ], components: [] });
    }

    // ── CONTRACT VIEW ─────────────────────────────────────────
    if (sub === 'contract') {
      const artistId = interaction.options.getString('artist_id');
      if (artistId === '__none__') return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('No artists on your roster.')], ephemeral: true });

      const contract = getContract(artistId);
      if (!contract || contract.labelOwnerId !== userId) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Artist not on your roster.')], ephemeral: true });

      const ct       = CONTRACT_TYPES[contract.type || 'standard'];
      const aName    = contract.isNPC ? `${contract.npcData?.emoji || '🎤'} ${contract.npcData?.name || artistId}` : `<@${artistId}>`;
      const advance  = contract.advance  || 0;
      const recouped = contract.recouped || 0;
      const isRecoup = advance > recouped;
      const rev      = calcArtistRevenue(contract);
      const labelRev = isRecoup ? rev : Math.floor(rev * (1 - (contract.artistCut || 30) / 100));
      const team     = (contract.team || []).map(r => `${TEAM_ROLES[r]?.emoji} ${TEAM_ROLES[r]?.name}`).join(', ') || 'None';

      const albumStatus = contract.albumBoostUntil && Date.now() < contract.albumBoostUntil
        ? `🔥 3× boost expires <t:${Math.floor(contract.albumBoostUntil / 1000)}:R>`
        : contract.lastAlbum
          ? `Last drop: <t:${Math.floor(contract.lastAlbum / 1000)}:D>`
          : 'No album dropped yet';

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📋 Contract — ${aName}`)
        .addFields(
          { name: '📄 Contract Type', value: `${ct?.emoji} ${ct?.name || 'Standard'}`, inline: true },
          { name: '🎤 Artist Cut',    value: `${contract.artistCut || 30}%`,            inline: true },
          { name: '📅 Signed',        value: `<t:${Math.floor(contract.signedAt / 1000)}:D>`, inline: true },
          { name: '💰 Advance',       value: advance > 0 ? fmtMoney(advance) : 'None', inline: true },
          { name: '⏳ Recouped',      value: advance > 0
            ? `${fmtMoney(recouped)} / ${fmtMoney(advance)} (${Math.round(recouped / advance * 100)}%)`
            : 'N/A', inline: true },
          { name: '📊 Label Rev/Tick',value: `${fmtMoney(labelRev)}${isRecoup ? ' *(recouping)*' : ''}`, inline: true },
          { name: '👥 Team',          value: team, inline: false },
          { name: '🎵 Album Status',  value: albumStatus, inline: false },
        )
        .setFooter({ text: isRecoup
          ? 'Label earns 100% until advance is fully recouped'
          : 'Advance recouped — normal split is active'
        })
      ], ephemeral: true });
    }

    // ── RELEASE ───────────────────────────────────────────────
    if (sub === 'release') {
      const artistId = interaction.options.getString('artist_id').replace(/[<@!>]/g, '');
      const idx      = label.artists.findIndex(a => a.artistId === artistId);
      if (idx === -1) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Artist not on your roster.')], ephemeral: true });

      const artist = label.artists[idx];
      label.artists.splice(idx, 1);
      await deleteContract(artistId);
      await saveLabel(userId, label);

      const name = artist.isNPC ? artist.npcData?.name : `<@${artistId}>`;
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888)
        .setDescription(`🎤 **${name}** has been released from **${biz.name}**.`)
      ]});
    }

    // ── PROMOTE ───────────────────────────────────────────────
    if (sub === 'promote') {
      const artistId = interaction.options.getString('artist_id');
      const budget   = interaction.options.getInteger('budget');
      const artist   = label.artists.find(a => a.artistId === artistId);
      if (!artist) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Artist not on your roster.')], ephemeral: true });

      const user = getOrCreateUser(userId);
      if (user.wallet < budget) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Need **${fmtMoney(budget)}** in wallet.`)], ephemeral: true });

      user.wallet -= budget;
      saveUser(userId, user);

      const contract = getContract(artistId);
      if (contract?.npcData) {
        contract.npcData.fanbase = Math.floor((contract.npcData.fanbase || 10000) + budget * 0.5);
        contract.npcData.hype    = Math.min(100, (contract.npcData.hype || 50) + Math.floor(budget / 10000));
        await saveContract(artistId, contract);
      }

      const name = artist.isNPC ? artist.npcData?.name : `<@${artistId}>`;
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('📣 Promotion Campaign')
        .setDescription(
          `**${name}** was promoted with **${fmtMoney(budget)}**.\n\n` +
          `+${Math.floor(budget * 0.5).toLocaleString()} fanbase · Hype boosted\n\n` +
          `Revenue increase reflects next tick.`
        )
      ]});
    }
  },
};
