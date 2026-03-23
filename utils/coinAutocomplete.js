// ============================================================
// utils/coinAutocomplete.js
// Shared coin autocomplete helper for shoutout, hate, invest, etc.
// ============================================================
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

async function coinAutocomplete(interaction, optionName = 'coin') {
  try {
    const typed = (interaction.options.getFocused() || '').toUpperCase();

    const [pdoc, custom] = await Promise.all([
      col('stockPrices').then(c => c.findOne({ _id:'prices' })).catch(()=>null),
      col('customCoins').then(c => c.find({}).toArray()).catch(()=>[]),
    ]);

    const prices    = pdoc ? { ...pdoc } : {};
    delete prices._id;
    const customMap = Object.fromEntries(custom.map(c => [c._id, c]));

    const allCoins = [
      ...DEFAULT_COINS,
      ...custom.map(c => ({ id:c._id, name:c.name, emoji:c.emoji||'🪙', owner:c.ownerId })),
    ];

    const opts = allCoins
      .filter(c => !typed || c.id.includes(typed) || c.name.toUpperCase().includes(typed))
      .slice(0, 25)
      .map(c => {
        const p    = prices[c.id];
        const tag  = customMap[c.id] ? ' 💻' : '';
        return { name:`${c.emoji} ${c.name} (${c.id}) — ${fmtP(p)}${tag}`, value:c.id };
      });

    await interaction.respond(opts.length ? opts : [{ name:'No coins found', value:'DOGE2' }]);
  } catch { await interaction.respond([{ name:'Error loading coins', value:'DOGE2' }]); }
}

module.exports = { coinAutocomplete, DEFAULT_COINS, fmtP };
