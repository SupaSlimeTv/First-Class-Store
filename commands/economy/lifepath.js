// ============================================================
// commands/economy/lifepath.js — /lifepath
// Choose your origin, view your character age & bonuses.
// ============================================================
const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { getOrCreateUser, hasAccount, saveUser } = require('../../utils/db');
const {
  getLifePath, createLifePath, setBornAt, getAgeString, getPathBonus, LIFE_PATHS,
} = require('../../utils/lifePathDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lifepath')
    .setDescription('🌱 Your origin, age, and life path bonuses.')
    .addSubcommand(s => s.setName('choose').setDescription('Choose your life path (one time)'))
    .addSubcommand(s => s.setName('status').setDescription('View your current life path and character age'))
    .addSubcommand(s => s.setName('paths').setDescription('Browse all available life paths and their bonuses')),

  async execute(interaction) {
    if (await noAccount(interaction)) return;

    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const lp     = getLifePath(userId);

    // ── CHOOSE ────────────────────────────────────────────────
    if (sub === 'choose') {
      if (lp?.path) {
        const pathDef = LIFE_PATHS[lp.path];
        return interaction.reply({ embeds:[new EmbedBuilder()
          .setColor(COLORS.ERROR)
          .setDescription(
            `You are already a **${pathDef.emoji} ${pathDef.name}**.\n\n` +
            `Life paths are permanent — your origin shapes who you are.`
          )
        ], ephemeral: true });
      }

      const rows = [];
      const paths = Object.values(LIFE_PATHS);

      // Two paths per row
      for (let i = 0; i < paths.length; i += 2) {
        const row = new ActionRowBuilder();
        for (let j = i; j < Math.min(i + 2, paths.length); j++) {
          const p = paths[j];
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`lp_choose_${p.id}`)
              .setLabel(`${p.emoji} ${p.name}`)
              .setStyle(ButtonStyle.Secondary)
          );
        }
        rows.push(row);
      }

      const desc = paths.map(p =>
        `**${p.emoji} ${p.name}** — ${p.description}\n` +
        p.bonusText.map(b => `  • ${b}`).join('\n')
      ).join('\n\n');

      return interaction.reply({
        embeds:[new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('🌱 Choose Your Life Path')
          .setDescription(
            `Where you came from defines where you\'re going.\n\n${desc}\n\n` +
            `⚠️ **This choice is permanent.** Choose wisely.`
          )
        ],
        components: rows,
      });
    }

    // ── STATUS ────────────────────────────────────────────────
    if (sub === 'status') {
      const user = getOrCreateUser(userId);

      if (!lp) {
        return interaction.reply({ embeds:[new EmbedBuilder()
          .setColor(0x888888)
          .setDescription('You haven\'t chosen a life path yet.\nUse `/lifepath choose` to pick your origin.')
        ], ephemeral: true });
      }

      const pathDef  = lp.path ? LIFE_PATHS[lp.path] : null;
      const ageStr   = getAgeString(lp.bornAt);
      const bornTs   = lp.bornAt ? `<t:${Math.floor(lp.bornAt / 1000)}:D>` : 'Unknown';

      const bonusLines = pathDef
        ? pathDef.bonusText.map(b => `• ${b}`).join('\n')
        : '*No path chosen — use `/lifepath choose`.*';

      const eligibleFactions = pathDef
        ? pathDef.illuminatiEligible.join(', ').replace(/_/g, ' ')
        : 'None';

      const embed = new EmbedBuilder()
        .setColor(pathDef?.color || 0x888888)
        .setTitle(`${pathDef?.emoji || '🌱'} ${interaction.user.username}'s Life`)
        .addFields(
          { name: '🎂 Born',       value: bornTs,                                  inline: true },
          { name: '📅 Age',        value: ageStr,                                  inline: true },
          { name: '​',             value: '​',                                     inline: true },
          { name: '🛤️ Life Path', value: pathDef ? `**${pathDef.name}**\n*${pathDef.flavor}*` : '*Not chosen*', inline: false },
          { name: '⚡ Bonuses',    value: bonusLines,                              inline: false },
          { name: '🔺 Illuminati Eligible Factions', value: eligibleFactions,      inline: false },
        );

      if (lp.chosenAt) {
        embed.setFooter({ text: `Path chosen on ${new Date(lp.chosenAt).toLocaleDateString()}` });
      }

      return interaction.reply({ embeds:[embed] });
    }

    // ── PATHS ─────────────────────────────────────────────────
    if (sub === 'paths') {
      const fields = Object.values(LIFE_PATHS).map(p => ({
        name: `${p.emoji} ${p.name} (+$${p.startingBonus.toLocaleString()} at birth)`,
        value: `*${p.description}*\n${p.bonusText.map(b => `• ${b}`).join('\n')}\n**Illuminati eligible:** ${p.illuminatiEligible.join(', ').replace(/_/g, ' ')}`,
        inline: false,
      }));

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('🌱 All Life Paths')
        .setDescription('Choose your origin with `/lifepath choose`. This is permanent.')
        .addFields(fields)
      ]});
    }
  },
};
