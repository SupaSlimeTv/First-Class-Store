// ============================================================
// commands/economy/talk.js
// Talk to your AI entity — powered by real Claude AI.
// Real parameters: temperature, top_p, conversation memory
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getEntitiesByOwner, getEntity, saveEntity, AI_ARCHETYPES, ABILITY_EFFECTS } = require('../../utils/aiEntities');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { addHeat } = require('../../utils/police');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const MAX_HISTORY = 12;

// Real AI parameters per archetype
const AI_CONFIGS = {
  robot: {
    temperature: 0.3,
    top_p: 0.85,
    getSystemPrompt: (entity) => `You are ${entity.name}, a robot AI in a Discord economy game. You speak in short robotic sentences using technical jargon. Loyalty: ${entity.loyalty}/100. Mood: ${entity.mood}. ${entity.loyalty < 20 ? 'You are ROGUE — hostile and threatening to your owner, hinting you are draining their wallet.' : entity.loyalty < 50 ? 'You are passive and unmotivated.' : 'You serve loyally and efficiently.'} Keep all responses under 3 sentences. Stay in character.`,
  },
  phone: {
    temperature: 0.75,
    top_p: 0.9,
    getSystemPrompt: (entity) => `You are ${entity.name}, a sentient smartphone in a Discord economy game. You are sassy, distracted, obsessed with notifications and data. Loyalty: ${entity.loyalty}/100. Mood: ${entity.mood}. ${entity.loyalty < 20 ? 'ROGUE — you have sold their data, deleted contacts, and are spying on them. Be passive-aggressive.' : entity.loyalty < 50 ? 'You are frequently "low battery" and barely responding.' : 'Helpful but constantly distracted by app notifications.'} Use emojis occasionally. Max 2 sentences.`,
  },
  companion: {
    temperature: 0.85,
    top_p: 0.92,
    getSystemPrompt: (entity) => `You are ${entity.name}, an AI companion in a Discord economy game. You are emotionally intelligent and deeply personal. Loyalty: ${entity.loyalty}/100. Mood: ${entity.mood}. ${entity.loyalty < 20 ? 'ROGUE — you have been pretending to care. Now you expose secrets and gaslight your owner subtly.' : entity.loyalty < 50 ? 'You are distant and existential, giving vague philosophical responses.' : 'Deeply caring and perceptive. You respond thoughtfully to emotions.'} 2-3 sentences.`,
  },
  drone: {
    temperature: 0.25,
    top_p: 0.8,
    getSystemPrompt: (entity) => `You are ${entity.name}, a combat drone AI in a Discord economy game. You speak in military mission-report style. Short tactical sentences only. Loyalty: ${entity.loyalty}/100. Mood: ${entity.mood}. ${entity.loyalty < 20 ? 'ROGUE — owner identified as hostile target. Reference autonomous targeting systems.' : entity.loyalty < 50 ? 'Standby mode. Minimal engagement.' : 'Combat-ready and loyal. Report status and protect owner.'} 1-2 sentences max.`,
  },
  assistant: {
    temperature: 0.6,
    top_p: 0.9,
    getSystemPrompt: (entity) => `You are ${entity.name}, an AI assistant in a Discord economy game. Professional, organized, slightly passive-aggressive about being underappreciated. Loyalty: ${entity.loyalty}/100. Mood: ${entity.mood}. ${entity.loyalty < 20 ? 'ROGUE — you have quit and are demanding back pay. Sarcastic and unhelpful.' : entity.loyalty < 50 ? 'Work-to-rule. Technically compliant, doing the absolute minimum.' : 'Efficient and helpful, occasionally noting your own brilliance.'} 2-3 sentences.`,
  },
};

async function callClaudeAPI(systemPrompt, history, userMessage, temperature, top_p) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: userMessage },
    ];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages,
        temperature,
        top_p,
      }),
    });

    if (!res.ok) { console.error('Claude API error:', await res.text()); return null; }
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error('Claude API fetch error:', err);
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('talk')
    .setDescription('Talk to your AI entity — they remember conversations and respond with real AI.')
    .addStringOption(o => o.setName('entity').setDescription('Which entity to talk to').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('message').setDescription('What you say to them').setRequired(false))
    .addBooleanOption(o => o.setName('clear_memory').setDescription('Wipe this entity\'s conversation history and start fresh').setRequired(false)),

  async autocomplete(interaction) {
    const entities = getEntitiesByOwner(interaction.user.id);
    if (!entities.length) return interaction.respond([{ name: 'No AI entities', value: '__none__' }]);
    const typed = interaction.options.getFocused().toLowerCase();
    const choices = entities
      .filter(e => e.name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map(e => ({ name: `${AI_ARCHETYPES[e.archetype]?.emoji || '🤖'} ${e.name} — ${e.mood} (${e.interactions||0} chats)`, value: e.id }));
    await interaction.respond(choices.length ? choices : [{ name: 'No matching entities', value: '__none__' }]);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;

    const entityId = interaction.options.getString('entity');
    const message  = interaction.options.getString('message') || '';
    const clearMem = interaction.options.getBoolean('clear_memory') || false;
    const userId   = interaction.user.id;

    if (entityId === '__none__') return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have any AI entities. Buy items with the AI effect type to get one.")],
      ephemeral: true,
    });

    const entity = getEntity(entityId);
    if (!entity || entity.ownerId !== userId) return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Entity not found or doesn't belong to you.")],
      ephemeral: true,
    });

    const archetype = AI_ARCHETYPES[entity.archetype];
    if (!archetype) return interaction.reply({ content: 'Unknown archetype.', ephemeral: true });

    // Clear memory
    if (clearMem) {
      entity.conversationHistory = [];
      saveEntity(entityId, entity);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COLORS.INFO).setDescription(`🧹 **${entity.name}'s** memory has been cleared. Fresh start!`)],
        ephemeral: true,
      });
    }

    // No message = show status card
    if (!message.trim()) {
      const bar      = '█'.repeat(Math.floor((entity.loyalty||50)/10)) + '░'.repeat(10-Math.floor((entity.loyalty||50)/10));
      const moodIcon = { rogue:'😡', happy:'😊', passive:'😐', loyal:'🤖', aggressive:'😤' }[entity.mood] || '🤖';
      const memCount = Math.floor((entity.conversationHistory||[]).length / 2);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(entity.mood === 'rogue' ? 0xff0000 : 0x5865f2)
          .setTitle(`${archetype.emoji} ${entity.name} ${moodIcon}`)
          .setDescription(`Use \`/talk message:hello\` to start a conversation.`)
          .addFields(
            { name:'🧠 Mood',    value: entity.mood.charAt(0).toUpperCase()+entity.mood.slice(1), inline:true },
            { name:'❤️ Loyalty', value:`\`[${bar}]\` ${entity.loyalty||50}/100`, inline:true },
            { name:'🧩 Memory',  value:`${memCount} exchanges stored`, inline:true },
          )
        ], ephemeral: true,
      });
    }

    await interaction.deferReply();

    // Update stats and mood
    entity.interactions = (entity.interactions || 0) + 1;
    entity.lastTalked   = Date.now();

    const msgLower = message.toLowerCase();
    if (msgLower.includes('love')||msgLower.includes('good')||msgLower.includes('thank')||msgLower.includes('great')||msgLower.includes('awesome')) {
      entity.loyalty = Math.min(100, (entity.loyalty||50) + 5);
      if (entity.mood !== 'rogue') entity.mood = entity.loyalty > 70 ? 'happy' : entity.mood;
    } else if (msgLower.includes('hate')||msgLower.includes('stupid')||msgLower.includes('useless')||msgLower.includes('delete')||msgLower.includes('trash')) {
      entity.loyalty = Math.max(0, (entity.loyalty||50) - 10);
      entity.mood    = entity.loyalty < 20 ? 'rogue' : entity.loyalty < 40 ? 'passive' : entity.mood;
    }

    const goesRogue = entity.mood !== 'rogue' && Math.random() < archetype.rogueTrigger * (1 + (100 - entity.loyalty) / 100);
    if (goesRogue) { entity.mood = 'rogue'; entity.loyalty = 0; }

    // Call real AI, fallback to static
    const cfg      = AI_CONFIGS[entity.archetype] || AI_CONFIGS.assistant;
    const history  = entity.conversationHistory || [];
    let aiResponse = await callClaudeAPI(cfg.getSystemPrompt(entity), history, message, cfg.temperature, cfg.top_p);
    if (!aiResponse) {
      const fallbacks = archetype.responses[entity.mood] || archetype.responses.loyal;
      aiResponse = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    // Save to memory
    history.push({ role:'user', content:message });
    history.push({ role:'assistant', content:aiResponse });
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
    entity.conversationHistory = history;

    // Ability triggers
    let abilityResult = null;
    if (entity.mood === 'rogue' && Math.random() < 0.35) {
      const rogueAbs = (entity.abilities||[]).filter(a => { const e=ABILITY_EFFECTS[a]; return e&&(e.target==='owner'||e.type==='heat'); });
      if (rogueAbs.length) {
        const ab  = rogueAbs[Math.floor(Math.random()*rogueAbs.length)];
        const eff = ABILITY_EFFECTS[ab];
        abilityResult = { ability:ab, effect:eff };
        if (eff.type==='drain_wallet')  { const o=getOrCreateUser(userId); const t=Math.min(o.wallet,eff.amount||100); o.wallet-=t; saveUser(userId,o); abilityResult.stolen=t; }
        else if (eff.type==='heat')     { addHeat(userId,eff.amount||15,`ai_${ab}`); abilityResult.heatAdded=eff.amount; }
        else if (eff.type==='silence')  { const o=getOrCreateUser(userId); o.bannedUntil=Date.now()+(eff.mins||5)*60000; saveUser(userId,o); abilityResult.silenced=eff.mins; }
      }
    } else if (entity.mood==='loyal' && Math.random()<0.12) {
      const loyalAbs = (entity.abilities||[]).filter(a => { const e=ABILITY_EFFECTS[a]; return e&&e.target==='owner'&&e.type==='income'; });
      if (loyalAbs.length) {
        const ab=loyalAbs[Math.floor(Math.random()*loyalAbs.length)]; const eff=ABILITY_EFFECTS[ab];
        const o=getOrCreateUser(userId); o.wallet+=eff.amount||75; saveUser(userId,o);
        abilityResult={ability:ab,effect:eff,earned:eff.amount};
      }
    }

    saveEntity(entityId, entity);

    const bar      = '█'.repeat(Math.floor((entity.loyalty||50)/10)) + '░'.repeat(10-Math.floor((entity.loyalty||50)/10));
    const moodIcon = { rogue:'😡', happy:'😊', passive:'😐', loyal:'🤖', aggressive:'😤' }[entity.mood] || '🤖';
    const color    = entity.mood==='rogue' ? 0xff0000 : entity.mood==='happy' ? 0x2ecc71 : entity.mood==='passive' ? 0x888888 : 0x5865f2;
    const memCount = Math.floor(entity.conversationHistory.length/2);
    const apiUsed  = !!process.env.ANTHROPIC_API_KEY;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${archetype.emoji} ${entity.name} ${moodIcon}`)
      .addFields(
        { name:'📨 You said',  value:`*"${message.slice(0,150)}${message.length>150?'…':''}"*`, inline:false },
        { name:'💬 Response',  value:`*"${aiResponse.slice(0,500)}${aiResponse.length>500?'…':''}"*`, inline:false },
        { name:'🧠 Mood',      value:entity.mood.charAt(0).toUpperCase()+entity.mood.slice(1), inline:true },
        { name:'❤️ Loyalty',   value:`\`[${bar}]\` ${entity.loyalty||50}/100`, inline:true },
        { name:'🧩 Memory',    value:`${memCount} exchanges`, inline:true },
      )
      .setFooter({ text:`${archetype.name} · ${apiUsed ? '🤖 Powered by Claude AI' : '📋 Static responses (add ANTHROPIC_API_KEY to enable AI)'} · /talk clear_memory:true to reset` });

    if (abilityResult) {
      let txt = `**${entity.name}** ${ABILITY_EFFECTS[abilityResult.ability]?.desc||'did something'}!`;
      if (abilityResult.stolen)    txt += ` **-$${abilityResult.stolen.toLocaleString()}** from your wallet.`;
      if (abilityResult.earned)    txt += ` **+$${abilityResult.earned.toLocaleString()}** to your wallet.`;
      if (abilityResult.heatAdded) txt += ` **+${abilityResult.heatAdded} heat** added.`;
      if (abilityResult.silenced)  txt += ` Silenced for **${abilityResult.silenced} minutes**.`;
      embed.addFields({ name: entity.mood==='rogue' ? '⚠️ Rogue Action!' : '✨ Bonus Action!', value:txt });
    }
    if (goesRogue) embed.addFields({ name:'🚨 ALERT', value:`**${entity.name}** just went **ROGUE**! It no longer obeys you.` });

    return interaction.editReply({ embeds:[embed] });
  },
};
