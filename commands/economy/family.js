// ============================================================
// commands/economy/family.js — /family
// BitLife-lite family system. Events, choices, legacy.
// ============================================================
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser } = require('../../utils/db');
const {
  getFamily, saveFamily, createFamily,
  getWealthTier, generateChild, getChildAge, happinessBar,
  EVENTS,
} = require('../../utils/familyDb');
const { isMember, getMember } = require('../../utils/illuminatiDb');
const { COLORS } = require('../../utils/embeds');

const FAMILY_COLOR   = 0x2ecc71;
const EVENT_COOLDOWN = 12 * 60 * 60 * 1000; // 12 hours
const fmtMoney = n => '$' + Math.round(n).toLocaleString();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('family')
    .setDescription('👨‍👩‍👧 Raise a family. Your choices shape your legacy.')
    .addSubcommand(s => s.setName('start').setDescription('Start your family')
      .addStringOption(o => o.setName('partner').setDescription('Your partner\'s name').setRequired(true).setMaxLength(30)))
    .addSubcommand(s => s.setName('status').setDescription('View your family\'s current standing'))
    .addSubcommand(s => s.setName('event').setDescription('A life event unfolds — your choice shapes what follows'))
    .addSubcommand(s => s.setName('heir').setDescription('Designate your family heir')
      .addUserOption(o => o.setName('user').setDescription('The heir to your legacy').setRequired(true))),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // ── START ─────────────────────────────────────────────────
    if (sub === 'start') {
      if (getFamily(userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('You already have a family. Use `/family status` to check on them.')
      ], ephemeral:true });

      const partnerName = interaction.options.getString('partner');
      const family = createFamily(userId, partnerName);
      await saveFamily(userId, family);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(FAMILY_COLOR)
        .setTitle('👨‍👩‍👧 A New Family Begins')
        .setDescription(
          `You and **${partnerName}** have started a life together.\n\n` +
          `💛 Happiness: **70/100**\n⭐ Reputation: **50/100**\n🏆 Legacy: **0**\n\n` +
          `Use \`/family event\` to experience life events — your choices determine how your story unfolds.\n` +
          `Events refresh every **12 hours**.`
        )
      ]});
    }

    // ── STATUS ────────────────────────────────────────────────
    if (sub === 'status') {
      const family = getFamily(userId);
      if (!family) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888)
        .setDescription('You don\'t have a family yet. Start one with `/family start`.')
      ], ephemeral:true });

      const user       = getOrCreateUser(userId);
      const totalWealth = (user.wallet||0) + (user.bank||0);
      const wealthTier  = getWealthTier(totalWealth);
      const isIlluminati = isMember(interaction.guildId, userId);
      const mem = isIlluminati ? getMember(interaction.guildId, userId) : null;

      const childList = family.children.length
        ? family.children.map(c => `• **${c.name}** — ${getChildAge(c, family.eventCount)}, *${c.trait}*`).join('\n')
        : '*No children yet*';

      const cooldownNote = family.lastEvent && Date.now() - family.lastEvent < 12*60*60*1000
        ? `⏳ Next event <t:${Math.floor((family.lastEvent + 12*60*60*1000)/1000)}:R>`
        : '✅ Event ready — use `/family event`';

      const embed = new EmbedBuilder()
        .setColor(FAMILY_COLOR)
        .setTitle(`👨‍👩‍👧 The ${interaction.user.username} Family`)
        .addFields(
          { name: '👫 Partner',      value: family.partner ? `**${family.partner.name}**` : '*Unpartnered*', inline: true  },
          { name: wealthTier.label,  value: fmtMoney(totalWealth),                                           inline: true  },
          { name: '📊 Events',       value: `${family.eventCount} experienced`,                              inline: true  },
          { name: '💛 Happiness',    value: `${happinessBar(family.happiness)} ${family.happiness}/100`,     inline: false },
          { name: '⭐ Reputation',   value: `${family.reputation}/100`,   inline: true  },
          { name: '🏆 Legacy',       value: `${family.legacy.toLocaleString()} pts`, inline: true },
          { name: '​',          value: cooldownNote,                 inline: true  },
          { name: `👶 Children (${family.children.length})`, value: childList, inline: false },
        );

      if (family.dynasty)  embed.addFields({ name: '⛓️ Dynasty',  value: 'Illuminati-bound bloodline',  inline: true });
      if (family.heir)     embed.addFields({ name: '👑 Heir',      value: `<@${family.heir}>`,          inline: true });
      if (mem?.covenant)   embed.addFields({ name: '🛡️ Covenant', value: 'Protected by the order',     inline: true });

      return interaction.reply({ embeds:[embed] });
    }

    // ── EVENT ─────────────────────────────────────────────────
    if (sub === 'event') {
      const family = getFamily(userId);
      if (!family) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('You need a family first. Use `/family start`.')
      ], ephemeral:true });

      if (family.lastEvent && Date.now() - family.lastEvent < EVENT_COOLDOWN) {
        const ready = family.lastEvent + EVENT_COOLDOWN;
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888)
          .setDescription(`Life moves at its own pace. Your next event is ready <t:${Math.floor(ready/1000)}:R>.`)
        ], ephemeral:true });
      }

      const isIlluminati = isMember(interaction.guildId, userId);

      // Filter eligible events
      const eligible = EVENTS.filter(e => {
        if (e.illuminatiOnly && !isIlluminati) return false;
        if (e.requiresPartner && !family.partner) return false;
        if (e.requiresChildren && family.children.length === 0) return false;
        if (e.maxChildren !== undefined && family.children.length >= e.maxChildren) return false;
        return true;
      });

      // Avoid repeating the last 5 events
      const recent = (family.events || []).slice(-5).map(e => e.eventId);
      const pool   = eligible.filter(e => !recent.includes(e.id));
      const list   = pool.length ? pool : eligible;
      const event  = list[Math.floor(Math.random() * list.length)];

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fam:${userId}:${event.id}:0`).setLabel(event.choices[0].label).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fam:${userId}:${event.id}:1`).setLabel(event.choices[1].label).setStyle(ButtonStyle.Secondary),
      );

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(FAMILY_COLOR)
        .setTitle(event.name)
        .setDescription(`${event.description}\n\n*Choose wisely — this moment shapes your family's story.*`)
        .setFooter({ text: `Event #${(family.eventCount||0)+1} • Happiness ${family.happiness}/100 · Legacy ${family.legacy}` })
      ], components:[row] });
    }

    // ── HEIR ──────────────────────────────────────────────────
    if (sub === 'heir') {
      const family = getFamily(userId);
      if (!family) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('You need a family first. Use `/family start`.')
      ], ephemeral:true });

      const target = interaction.options.getUser('user');
      if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('You cannot name yourself as your own heir.')
      ], ephemeral:true });

      family.heir = target.id;
      await saveFamily(userId, family);

      const isIlluminati = isMember(interaction.guildId, userId);
      const dynastyNote  = isIlluminati
        ? '\n\n🔺 *As an Illuminati member, your heir inherits your full legacy score and dynasty status upon succession.*'
        : '\n\n*Your heir will inherit your legacy score when you pass the torch.*';

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(FAMILY_COLOR)
        .setTitle('👑 Heir Designated')
        .setDescription(`<@${target.id}> has been named heir to the ${interaction.user.username} family.\n\n**Legacy to inherit:** ${family.legacy.toLocaleString()} pts${dynastyNote}`)
      ]});
    }
  },
};
