// utils/coinAutocomplete.js — with timeout fallback so it never shows "Loading options failed"
const { col } = require('./mongo');

const DEFAULT_COINS = [
  { id:'DOGE2',  name:'Doge 2.0',       emoji:'🐕' },
  { id:'PEPE',   name:'PepeCoin',        emoji:'🐸' },
  { id:'RUGPUL', name:'RugPull Finance', emoji:'🪤' },
  { id:'MOON',   name:'MoonShot',        emoji:'🚀' },
  { id:'BODEN',  name:'BodenBucks',      emoji:'🦅' },
  { id:'CHAD',   name:'ChadToken',       emoji:'💪' },
];

const fmtP = (p) => {
  if (!p || isNaN(p)) return '?';
  if (p >= 1e12) return '$' + (p/1e12).toFixed(2) + 'T';
  if (p >= 1e9)  return '$' + (p/1e9).toFixed(2)  + 'B';
  if (p >= 1e6)  return '$' + (p/1e6).toFixed(2)  + 'M';
  if (p >= 1000) return '$' + Math.round(p).toLocaleString();
  if (p >= 1)    return '$' + p.toFixed(2);
  return '$' + p.toFixed(4);
};

async function coinAutocomplete(interaction) {
  const typed = (interaction.options.getFocused() || '').toUpperCase();

  // Race MongoDB against a 2s timeout — always respond within Discord's window
  const dbFetch = Promise.all([
    col('stockPrices').then(c => c.findOne({ _id:'prices' })).catch(() => null),
    col('customCoins').then(c => c.find({}).toArray()).catch(() => []),
  ]);
  const timeout = new Promise(res => setTimeout(() => res([null, []]), 2000));

  const [pdoc, custom] = await Promise.race([dbFetch, timeout]);

  const prices = pdoc ? { ...pdoc } : {};
  delete prices._id;

  const allCoins = [
    ...DEFAULT_COINS,
    ...(custom || []).map(c => ({ id: c._id, name: c.name, emoji: c.emoji || '🪙' })),
  ];

  const opts = allCoins
    .filter(c => !typed || c.id.includes(typed) || c.name.toUpperCase().includes(typed))
    .slice(0, 25)
    .map(c => ({
      name: `${c.emoji} ${c.name} (${c.id})${prices[c.id] ? ' — ' + fmtP(prices[c.id]) : ''}`,
      value: c.id,
    }));

  await interaction.respond(opts.length ? opts : DEFAULT_COINS.map(c => ({ name: `${c.emoji} ${c.name}`, value: c.id }))).catch(() => null);
}

module.exports = { coinAutocomplete, DEFAULT_COINS, fmtP };
