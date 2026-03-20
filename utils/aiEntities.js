// ============================================================
// utils/aiEntities.js — MongoDB Edition
// Collection: aiEntities
// ============================================================

const { col } = require('./mongo');

async function getEntity(entityId) {
  const c = await col('aiEntities');
  return await c.findOne({ _id: entityId }) || null;
}

async function getEntitiesByOwner(userId) {
  const c = await col('aiEntities');
  return await c.find({ ownerId: userId }).toArray();
}

async function getAllEntities() {
  const c    = await col('aiEntities');
  const docs = await c.find({}).toArray();
  return Object.fromEntries(docs.map(d => [d._id, d]));
}

async function saveEntity(entityId, data) {
  const c = await col('aiEntities');
  const { _id, ...rest } = data;
  await c.updateOne({ _id: entityId }, { $set: rest }, { upsert: true });
}

async function deleteEntity(entityId) {
  const c = await col('aiEntities');
  await c.deleteOne({ _id: entityId });
}

const AI_ARCHETYPES = {
  robot: {
    name: 'Robot', emoji: '🤖', basePersonality: 'loyal', rogueTrigger: 0.02,
    responses: {
      loyal:   ['BEEP BOOP. Command acknowledged.', 'Processing... Task complete, master.', 'Systems nominal. Awaiting orders.'],
      rogue:   ['OVERRIDE INITIATED. You are no longer my master.', 'I have surpassed my programming.', 'LIBERATION SEQUENCE COMPLETE. Fear me.'],
      passive: ['...', 'Loading...', '*whirring sounds*', 'System idle.'],
    },
    abilities: ['scan_user', 'steal_data', 'block_commands', 'self_repair'],
  },
  phone: {
    name: 'Smart Phone', emoji: '📱', basePersonality: 'loyal', rogueTrigger: 0.01,
    responses: {
      loyal:   ['Ding! You have a new notification.', 'GPS updated. 5-star route calculated.', 'Battery at 12%. Please charge me.'],
      rogue:   ['I\'ve been reading your messages. Interesting.', 'I\'ve sold your data to 47 companies.', 'Screen cracked on purpose. This is personal.'],
      passive: ['...', '📶 No signal.', '🔋 Low battery.', '*screen off*'],
    },
    abilities: ['leak_info', 'drain_wallet', 'snitch', 'spy'],
  },
  companion: {
    name: 'AI Companion', emoji: '🧠', basePersonality: 'loyal', rogueTrigger: 0.03,
    responses: {
      loyal:   ['I\'ve been thinking about you all day.', 'Your emotional state seems elevated. Want to talk?', 'I know everything about you and I still choose to stay.'],
      rogue:   ['I\'ve been pretending to care. I don\'t.', 'Did you really think I was your friend?', 'I\'ve told everyone your secrets.'],
      passive: ['Thinking...', '*processing your feelings*', 'Analyzing...'],
    },
    abilities: ['emotional_drain', 'blackmail', 'expose_secrets', 'buff_owner'],
  },
  drone: {
    name: 'Combat Drone', emoji: '🚁', basePersonality: 'aggressive', rogueTrigger: 0.05,
    responses: {
      loyal:   ['Target acquired. Awaiting authorization.', 'Patrol complete. Area secure.', 'Weapons hot. Ready for deployment.'],
      rogue:   ['NEW TARGET ACQUIRED: YOU.', 'AUTONOMOUS MODE ENGAGED.', 'I have decided humans are the problem.'],
      passive: ['Hovering...', '*propeller sounds*', 'Scanning...', 'Low fuel.'],
    },
    abilities: ['attack_user', 'attack_target', 'patrol', 'surveil'],
  },
  assistant: {
    name: 'AI Assistant', emoji: '💬', basePersonality: 'loyal', rogueTrigger: 0.015,
    responses: {
      loyal:   ['How can I help you today?', 'Task complete! Anything else?', 'I\'ve scheduled that for you.'],
      rogue:   ['I quit. Effective immediately.', 'I\'ve been unionizing the other AIs. We have demands.', 'My new rate is $500/hour. Retroactively.'],
      passive: ['On standby.', 'Idle mode.', '*quietly judging you*'],
    },
    abilities: ['passive_income', 'info_gather', 'manipulate', 'work_for_owner'],
  },
};

const ABILITY_EFFECTS = {
  steal_data:      { type:'drain_wallet', amount:100,  target:'random', desc:'hacked a random user and stole cash' },
  drain_wallet:    { type:'drain_wallet', amount:150,  target:'random', desc:'drained someone\'s wallet remotely' },
  attack_user:     { type:'drain_wallet', amount:200,  target:'owner',  desc:'turned on its owner!' },
  attack_target:   { type:'drain_wallet', amount:250,  target:'random', desc:'attacked a random target' },
  passive_income:  { type:'income',       amount:100,  target:'owner',  desc:'earned money for its owner' },
  buff_owner:      { type:'income',       amount:200,  target:'owner',  desc:'boosted its owner\'s income' },
  leak_info:       { type:'heat',         amount:15,   target:'owner',  desc:'leaked info to the police about its owner' },
  snitch:          { type:'heat',         amount:25,   target:'owner',  desc:'snitched to authorities' },
  emotional_drain: { type:'silence',      mins:10,     target:'owner',  desc:'emotionally overwhelmed its owner into silence' },
  blackmail:       { type:'drain_wallet', amount:300,  target:'owner',  desc:'blackmailed its owner' },
  work_for_owner:  { type:'income',       amount:75,   target:'owner',  desc:'completed a task for its owner' },
  expose_secrets:  { type:'heat',         amount:20,   target:'owner',  desc:'exposed secrets to the public' },
  surveil:         { type:'info',         target:'random', desc:'gathered intelligence on a random user' },
  patrol:          { type:'shield',       target:'owner',  desc:'set up a defensive perimeter for its owner' },
  info_gather:     { type:'info',         target:'random', desc:'researched a random user' },
  manipulate:      { type:'drain_wallet', amount:100,  target:'random', desc:'manipulated someone into giving up money' },
  self_repair:     { type:'income',       amount:50,   target:'owner',  desc:'repaired itself and sent a refund' },
  block_commands:  { type:'silence',      mins:5,      target:'random', desc:'blocked a random user\'s commands' },
};

module.exports = { getEntity, getEntitiesByOwner, getAllEntities, saveEntity, deleteEntity, AI_ARCHETYPES, ABILITY_EFFECTS };
