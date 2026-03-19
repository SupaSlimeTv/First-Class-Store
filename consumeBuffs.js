// ============================================================
// utils/consumeBuffs.js — Consume Buff Reader
// Checks if a user has an active consume buff of a given type
// ============================================================

const fs   = require('fs');
const path = require('path');

const FX_FILE = path.join(__dirname, '../data/activeEffects.json');

function readEffects() {
  try { return fs.existsSync(FX_FILE) ? JSON.parse(fs.readFileSync(FX_FILE, 'utf8')) : {}; } catch { return {}; }
}
function writeEffects(data) { fs.writeFileSync(FX_FILE, JSON.stringify(data, null, 2)); }

// Returns the strength of the first active buff of the given type, or 0
function getConsumeBuff(userId, buffType) {
  const all    = readEffects();
  const userFx = all[userId];
  if (!userFx?.consume) return 0;
  const now    = Date.now();
  const active = userFx.consume.filter(c => c.expiresAt > now && c.buffType === buffType);
  if (!active.length) return 0;
  return active.reduce((sum, c) => sum + (c.strength || 0), 0); // stack strengths
}

// Tick poisoned debuff — drain wallet slowly
function tickConsumeDebuffs() {
  const all = readEffects();
  let changed = false;
  const db  = require('./db');
  const now = Date.now();

  for (const userId in all) {
    const userFx = all[userId];
    if (!userFx.consume) continue;
    // Clean up expired
    const before = userFx.consume.length;
    userFx.consume = userFx.consume.filter(c => c.expiresAt > now);
    if (userFx.consume.length !== before) changed = true;

    // Apply poison tick
    const poisons = userFx.consume.filter(c => c.buffType === 'poisoned');
    for (const poison of poisons) {
      const user = db.getUser(userId);
      if (!user) continue;
      const drain = Math.floor(user.wallet * (poison.strength / 100) * (60000 / ((poison.expiresAt - poison.appliedAt) || 600000)));
      if (drain > 0) { user.wallet = Math.max(0, user.wallet - drain); db.saveUser(userId, user); changed = true; }
    }
  }
  if (changed) writeEffects(all);
}

// List all active consume buffs for a user (for /status command)
function listConsumeBuffs(userId) {
  const all    = readEffects();
  const userFx = all[userId];
  if (!userFx?.consume) return [];
  const now = Date.now();
  return userFx.consume
    .filter(c => c.expiresAt > now)
    .map(c => ({ ...c, minutesLeft: Math.ceil((c.expiresAt - now) / 60000) }));
}

module.exports = { getConsumeBuff, tickConsumeDebuffs, listConsumeBuffs };
