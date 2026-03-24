// ============================================================
// utils/autocomplete.js — Shared autocomplete helpers
// One import handles all common autocomplete patterns
// ============================================================

const { getUser, getStore, getAllUsers } = require('./db');
const { getBusiness, getAllBusinesses, BIZ_TYPES } = require('./bizDb');
const { getAllGangs } = require('./gangDb');
const { getAllPhones, getStatusTier } = require('./phoneDb');
const { getCredit, getCreditTier } = require('./creditDb');
const { getLabel, NPC_ARTISTS } = require('./labelDb');
const { getIlluminati } = require('./illuminatiDb');
const { BUILTIN_APPS } = require('./laptopDb');

// Filter + slice helper
function filter(choices, typed) {
  const q = (typed||'').toLowerCase();
  return choices
    .filter(c => c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q))
    .slice(0, 25);
}

// ── ITEM AUTOCOMPLETE (store items) ──────────────────────────
function itemAutocomplete(interaction, optionName = 'item') {
  const store  = getStore(interaction.guildId);
  const typed  = interaction.options.getFocused().toLowerCase();
  const items  = (store.items || []).map(i => ({
    name: `${i.emoji||'📦'} ${i.name} — $${(i.price||0).toLocaleString()}`,
    value: i.id,
  }));
  return interaction.respond(filter(items, typed));
}

// ── INVENTORY AUTOCOMPLETE ────────────────────────────────────
function inventoryAutocomplete(interaction) {
  const user  = getUser(interaction.user.id);
  const store = getStore(interaction.guildId);
  const typed = interaction.options.getFocused().toLowerCase();
  if (!user?.inventory?.length) return interaction.respond([{ name:'Inventory empty', value:'__none__' }]);
  const counts = user.inventory.reduce((a,id) => { a[id]=(a[id]||0)+1; return a; }, {});
  const choices = Object.entries(counts).map(([id,cnt]) => {
    const item = store.items.find(i=>i.id===id);
    return { name:`${item?.name||id}${cnt>1?` ×${cnt}`:''}`, value:id };
  });
  return interaction.respond(filter(choices, typed));
}

// ── BUSINESS TYPE AUTOCOMPLETE ────────────────────────────────
function bizTypeAutocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const choices = Object.entries(BIZ_TYPES).map(([id, b]) => ({
    name: `${b.emoji||'🏢'} ${b.name}`,
    value: id,
  }));
  return interaction.respond(filter(choices, typed));
}

// ── GANG AUTOCOMPLETE ─────────────────────────────────────────
function gangAutocomplete(interaction) {
  const typed  = interaction.options.getFocused().toLowerCase();
  const gangs  = getAllGangs();
  const choices = Object.entries(gangs).map(([id, g]) => ({
    name: `${g.emoji||'🏴'} ${g.name} (${(g.members||[]).length} members)`,
    value: id,
  }));
  return interaction.respond(filter(choices, typed));
}

// ── USER/MEMBER AUTOCOMPLETE ──────────────────────────────────
async function memberAutocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  try {
    const members = await interaction.guild.members.fetch();
    const choices = members
      .filter(m => !m.user.bot)
      .map(m => ({ name: m.user.username, value: m.user.id }))
      .filter(c => c.name.toLowerCase().includes(typed))
      .slice(0, 25);
    return interaction.respond(choices);
  } catch {
    return interaction.respond([]);
  }
}

// ── LAPTOP APP AUTOCOMPLETE ───────────────────────────────────
function laptopAppAutocomplete(interaction) {
  const typed   = interaction.options.getFocused().toLowerCase();
  const choices = Object.entries(BUILTIN_APPS).map(([id, a]) => ({
    name: `${a.emoji} ${a.name} — ${a.category}`,
    value: id,
  }));
  return interaction.respond(filter(choices, typed));
}

// ── NPC ARTIST AUTOCOMPLETE ───────────────────────────────────
function npcArtistAutocomplete(interaction) {
  const typed   = interaction.options.getFocused().toLowerCase();
  const choices = NPC_ARTISTS.map(a => ({
    name: `${a.emoji} ${a.name} — Talent:${a.talent} Hype:${a.hype}`,
    value: a.id,
  }));
  return interaction.respond(filter(choices, typed));
}

// ── ILLUMINATI RANK AUTOCOMPLETE ─────────────────────────────
function illuminatiRankAutocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const choices = [
    { name:'🔺 Initiate', value:'initiate' },
    { name:'👁️ Operative', value:'operative' },
    { name:'💎 Elder', value:'elder' },
    { name:'⚡ Grandmaster', value:'grandmaster' },
  ];
  return interaction.respond(filter(choices, typed));
}

// ── GUN AUTOCOMPLETE ──────────────────────────────────────────
function gunAutocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const user  = getUser(interaction.user.id);
  const guns  = user?.guns || [];
  if (!guns.length) return interaction.respond([{ name:'No guns owned', value:'__none__' }]);
  const choices = guns.map(g => ({ name:`${g.name||g.id}`, value:g.id||g.name }));
  return interaction.respond(filter(choices, typed));
}

// ── DRUG AUTOCOMPLETE ─────────────────────────────────────────
function drugAutocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const store = getStore(interaction.guildId);
  const drugs = (store.items||[]).filter(i=>i.isDrug);
  if (!drugs.length) return interaction.respond([{ name:'No drugs in store', value:'__none__' }]);
  return interaction.respond(filter(drugs.map(d=>({ name:`${d.name} — $${d.price?.toLocaleString()||'?'}`, value:d.id })), typed));
}

module.exports = {
  filter,
  itemAutocomplete,
  inventoryAutocomplete,
  bizTypeAutocomplete,
  gangAutocomplete,
  memberAutocomplete,
  laptopAppAutocomplete,
  npcArtistAutocomplete,
  illuminatiRankAutocomplete,
  gunAutocomplete,
  drugAutocomplete,
};
