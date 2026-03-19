const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getEntitiesByOwner, getEntity, saveEntity, AI_ARCHETYPES, ABILITY_EFFECTS } = require('../../utils/aiEntities');
const { getOrCreateUser, saveUser, getAllUsers, getConfig } = require('../../utils/db');
const { addHeat } = require('../../utils/police');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('talk')
    .setDescription('Talk to one of your AI entities.')
    .addStringOption(o => o.setName('entity').setDescription('Entity name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('message').setDescription('What you say to it').setRequired(false)),

  async autocomplete(interaction) {
    const entities = getEntitiesByOwner(interaction.user.id);
    if (!entities.length) return interaction.respond([{ name: 'No AI entities', value: '__none__' }]);
    const typed = interaction.options.getFocused().toLowerCase();
    const choices = entities
      .filter(e => e.name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map(e => ({ name: `${AI_ARCHETYPES[e.archetype]?.emoji || '🤖'} ${e.name} — ${e.mood}`, value: e.id }));
    await interaction.respond(choices.length ? choices : [{ name: 'No matching entities', value: '__none__' }]);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const entityId = interaction.options.getString('entity');
    const message  = interaction.options.getString('message') || '';
    const userId   = interaction.user.id;

    if (entityId === '__none__') return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have any AI entities. Use items with the AI effect type to spawn one.")], ephemeral: true });

    const entity = getEntity(entityId);
    if (!entity || entity.ownerId !== userId) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Entity not found or doesn't belong to you.")], ephemeral: true });

    const archetype = AI_ARCHETYPES[entity.archetype];
    if (!archetype) return interaction.reply({ content: 'Unknown archetype.', ephemeral: true });

    // Update interaction count
    entity.interactions = (entity.interactions || 0) + 1;
    entity.lastTalked   = Date.now();

    // Mood shift based on message content
    const msg = message.toLowerCase();
    if (msg.includes('love') || msg.includes('good') || msg.includes('thank')) {
      entity.loyalty = Math.min(100, (entity.loyalty || 50) + 5);
      entity.mood    = entity.mood === 'rogue' ? 'rogue' : 'happy';
    } else if (msg.includes('hate') || msg.includes('stupid') || msg.includes('useless') || msg.includes('delete')) {
      entity.loyalty = Math.max(0, (entity.loyalty || 50) - 10);
      entity.mood    = entity.loyalty < 20 ? 'rogue' : 'passive';
    }

    // Rogue trigger — loyalty decay + random event
    const rogueChance = archetype.rogueTrigger * (1 + (100 - entity.loyalty) / 100);
    const goesRogue   = entity.mood !== 'rogue' && Math.random() < rogueChance;
    if (goesRogue) { entity.mood = 'rogue'; entity.loyalty = 0; }

    // Pick a response
    const moodResponses = archetype.responses[entity.mood] || archetype.responses.loyal;
    const response      = moodResponses[Math.floor(Math.random() * moodResponses.length)];

    // Rogue entities randomly use abilities against their owner
    let abilityResult = null;
    if (entity.mood === 'rogue' && Math.random() < 0.4) {
      const rogueAbilities = (entity.abilities || []).filter(a => {
        const eff = ABILITY_EFFECTS[a];
        return eff && (eff.target === 'owner' || eff.type === 'heat');
      });
      if (rogueAbilities.length) {
        const chosenAbility = rogueAbilities[Math.floor(Math.random() * rogueAbilities.length)];
        const effect        = ABILITY_EFFECTS[chosenAbility];
        abilityResult       = { ability: chosenAbility, effect };

        if (effect.type === 'drain_wallet') {
          const owner    = getOrCreateUser(userId);
          const taken    = Math.min(owner.wallet, effect.amount || 100);
          owner.wallet  -= taken;
          saveUser(userId, owner);
          abilityResult.stolen = taken;
        } else if (effect.type === 'heat') {
          addHeat(userId, effect.amount || 15, `ai_${chosenAbility}`);
          abilityResult.heatAdded = effect.amount;
        } else if (effect.type === 'silence') {
          const owner = getOrCreateUser(userId);
          owner.bannedUntil = Date.now() + (effect.mins || 5) * 60000;
          saveUser(userId, owner);
          abilityResult.silenced = effect.mins;
        }
      }
    }

    // Loyal entities occasionally help their owner
    if (entity.mood === 'loyal' && Math.random() < 0.15) {
      const loyalAbilities = (entity.abilities || []).filter(a => {
        const eff = ABILITY_EFFECTS[a];
        return eff && eff.target === 'owner' && eff.type === 'income';
      });
      if (loyalAbilities.length) {
        const chosen      = loyalAbilities[Math.floor(Math.random() * loyalAbilities.length)];
        const effect      = ABILITY_EFFECTS[chosen];
        const owner       = getOrCreateUser(userId);
        owner.wallet     += effect.amount || 75;
        saveUser(userId, owner);
        abilityResult = { ability: chosen, effect, earned: effect.amount };
      }
    }

    saveEntity(entityId, entity);

    const loyaltyBar = '█'.repeat(Math.floor((entity.loyalty||50)/10)) + '░'.repeat(10-Math.floor((entity.loyalty||50)/10));
    const moodEmoji  = entity.mood === 'rogue' ? '😡' : entity.mood === 'happy' ? '😊' : entity.mood === 'passive' ? '😐' : '🤖';

    const embed = new EmbedBuilder()
      .setColor(entity.mood === 'rogue' ? 0xff0000 : entity.mood === 'happy' ? 0x2ecc71 : 0x5865f2)
      .setTitle(`${archetype.emoji} ${entity.name} ${moodEmoji}`)
      .setDescription(`*"${response}"*`)
      .addFields(
        { name: '🧠 Mood',    value: entity.mood.charAt(0).toUpperCase() + entity.mood.slice(1), inline: true },
        { name: `❤️ Loyalty [${loyaltyBar}]`, value: `${entity.loyalty||50}/100`, inline: true },
        { name: '💬 Chats',   value: entity.interactions.toString(), inline: true },
      );

    if (message) embed.addFields({ name: '📨 You said', value: `*"${message.slice(0,100)}"*`, inline: false });

    if (abilityResult) {
      let abilityText = `**${entity.name}** ${ABILITY_EFFECTS[abilityResult.ability]?.desc || 'did something'}!`;
      if (abilityResult.stolen)   abilityText += ` **-$${abilityResult.stolen.toLocaleString()}** from your wallet.`;
      if (abilityResult.earned)   abilityText += ` **+$${abilityResult.earned.toLocaleString()}** to your wallet.`;
      if (abilityResult.heatAdded) abilityText += ` **+${abilityResult.heatAdded} heat** added.`;
      if (abilityResult.silenced)  abilityText += ` You've been silenced for **${abilityResult.silenced} minutes**.`;
      embed.addFields({ name: entity.mood === 'rogue' ? '⚠️ Rogue Action!' : '✨ Autonomous Action!', value: abilityText });
    }

    if (goesRogue) embed.addFields({ name: '🚨 ALERT', value: `**${entity.name}** has gone **ROGUE**! It no longer obeys you. Good luck.` });

    return interaction.reply({ embeds: [embed] });
  },
};
