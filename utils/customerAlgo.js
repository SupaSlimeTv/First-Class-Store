// ============================================================
// utils/customerAlgo.js — NPC Customer Algorithm
// Customers pick businesses based on appeal score, randomness,
// reputation, business type preference, and recent performance
// ============================================================

const { calcBusinessAppeal } = require('./npcEmployees');
const { getAllBusinesses, saveBusiness } = require('./bizDb');
const db = require('./db');

const CUSTOMER_VISIT_INTERVAL = 5 * 60 * 1000; // every 5 minutes

// Customer archetypes — each has type preferences and spending power
const CUSTOMER_TYPES = [
  { name: 'Big Spender',  multiplier: 3.0, preferredTypes: ['casino','realestate','techstartup'], weight: 5  },
  { name: 'Regular',      multiplier: 1.0, preferredTypes: [],                                    weight: 40 },
  { name: 'Bargain Hunter',multiplier: 0.6, preferredTypes: ['streetfood','barbershop','carwash'], weight: 25 },
  { name: 'Enthusiast',   multiplier: 1.8, preferredTypes: ['recordlabel','restaurant','gym'],     weight: 20 },
  { name: 'VIP',          multiplier: 5.0, preferredTypes: ['casino','realestate'],                weight: 10 },
];

function weightedRandom(items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

// Softmax selection — higher appeal = more likely to be chosen
function selectBusiness(businesses, customerType) {
  if (!businesses.length) return null;

  const scores = businesses.map(biz => {
    let appeal = calcBusinessAppeal(biz);

    // Type preference bonus
    if (customerType.preferredTypes.includes(biz.type)) appeal *= 1.5;

    // Recent visits penalty (prevents one business dominating)
    const lastVisit = biz.lastCustomerVisit || 0;
    const timeSince = Date.now() - lastVisit;
    if (timeSince < 60000) appeal *= 0.3; // heavily penalize if visited <1min ago

    return { biz, appeal: Math.max(1, appeal) };
  });

  // Softmax
  const maxAppeal = Math.max(...scores.map(s => s.appeal));
  const exps = scores.map(s => ({ biz: s.biz, exp: Math.exp((s.appeal - maxAppeal) / 30) }));
  const total = exps.reduce((s, e) => s + e.exp, 0);

  let r = Math.random() * total;
  for (const e of exps) {
    r -= e.exp;
    if (r <= 0) return e.biz;
  }
  return exps[exps.length - 1].biz;
}

async function tickCustomers(client, announceChannelId) {
  try {
    const all = getAllBusinesses();
    const businesses = Object.entries(all);
    if (!businesses.length) return;

    const activeBusinesses = businesses.map(([, biz]) => biz).filter(b => b.level > 0);
    if (!activeBusinesses.length) return;

    // Generate 1-4 customer visits per tick
    const visitCount = Math.floor(1 + Math.random() * 3);

    for (let i = 0; i < visitCount; i++) {
      const customerType = weightedRandom(CUSTOMER_TYPES);
      const target       = selectBusiness(activeBusinesses, customerType);
      if (!target) continue;

      const baseSpend  = 20 + Math.random() * 80;
      const spend      = Math.floor(baseSpend * customerType.multiplier * (1 + (target.level - 1) * 0.1));

      // Add to business revenue
      const allBiz = getAllBusinesses();
      const biz    = allBiz[target.ownerId];
      if (!biz) continue;

      biz.revenue           = (biz.revenue || 0) + spend;
      biz.totalCustomers    = (biz.totalCustomers || 0) + 1;
      biz.lastCustomerVisit = Date.now();
      biz.reputation        = Math.min(100, (biz.reputation || 0) + 0.5);

      saveBusiness(target.ownerId, biz);

      // Rare: announce a VIP visit
      if (customerType.name === 'VIP' && announceChannelId && client) {
        try {
          const channel = await client.channels.fetch(announceChannelId).catch(() => null);
          if (channel) {
            const { EmbedBuilder } = require('discord.js');
            await channel.send({ embeds: [new EmbedBuilder()
              .setColor(0xf5c518)
              .setTitle('👑 VIP Customer Alert!')
              .setDescription(`A VIP customer just dropped **$${spend.toLocaleString()}** at **${biz.name}**!\n<@${biz.ownerId}>'s business is popping off.`)
            ]});
          }
        } catch {}
      }
    }
  } catch (e) { console.error('Customer tick error:', e); }
}

module.exports = { tickCustomers, CUSTOMER_VISIT_INTERVAL };
