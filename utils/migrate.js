// ============================================================
// migrate.js — One-Time Data Migration Script
// Run ONCE with: node migrate.js
//
// Reads your existing data/*.json files and stamps everything
// with your Guild ID so it works with the multi-server system.
//
// Your existing player wallets, inventory, gangs, etc. are
// preserved — they just get tagged to your server.
// ============================================================

require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs   = require('fs');
const path = require('path');

const GUILD_ID = process.env.GUILD_ID;
if (!GUILD_ID) { console.error('❌ GUILD_ID not set in .env'); process.exit(1); }

const URI = process.env.MONGODB_URI;
if (!URI) { console.error('❌ MONGODB_URI not set in .env'); process.exit(1); }

function readJSON(file) {
  const p = path.join(__dirname, 'data', file);
  if (!fs.existsSync(p)) { console.log(`  ⚠️  ${file} not found, skipping`); return null; }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

async function migrate() {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db();
  console.log('✅ Connected to MongoDB\n');
  console.log(`🏠 Migrating data for Guild ID: ${GUILD_ID}\n`);

  // ── USERS (global — no guildId needed) ──────────────────────
  const users = readJSON('users.json');
  if (users && Object.keys(users).length) {
    const col  = db.collection('users');
    const ops  = Object.entries(users).map(([id, data]) => ({
      updateOne: { filter: { _id: id }, update: { $setOnInsert: { _id: id, ...data } }, upsert: true },
    }));
    await col.bulkWrite(ops);
    console.log(`✅ Users migrated: ${ops.length} records`);
  }

  // ── CONFIG (per-server) ──────────────────────────────────────
  const config = readJSON('config.json');
  if (config) {
    const col = db.collection(`config_${GUILD_ID}`);
    await col.updateOne({ _id: 'config' }, { $setOnInsert: { _id: 'config', ...config } }, { upsert: true });
    console.log(`✅ Config migrated → config_${GUILD_ID}`);
  }

  // ── STORE (global) ───────────────────────────────────────────
  const store = readJSON('store.json');
  if (store) {
    const col = db.collection('store');
    await col.updateOne({ _id: 'store' }, { $setOnInsert: { _id: 'store', ...store } }, { upsert: true });
    console.log(`✅ Store migrated (global)`);
  }

  // ── GANGS (per-server) ───────────────────────────────────────
  const gangs = readJSON('gangs.json');
  if (gangs && Object.keys(gangs).length) {
    const col = db.collection(`gangs_${GUILD_ID}`);
    const ops = Object.entries(gangs).map(([id, data]) => ({
      updateOne: { filter: { _id: id }, update: { $setOnInsert: { _id: id, ...data } }, upsert: true },
    }));
    await col.bulkWrite(ops);
    console.log(`✅ Gangs migrated: ${ops.length} records → gangs_${GUILD_ID}`);
  }

  // ── POLICE (per-server) ──────────────────────────────────────
  const police = readJSON('police.json');
  if (police && Object.keys(police).length) {
    const col = db.collection(`police_${GUILD_ID}`);
    const ops = Object.entries(police).map(([id, data]) => ({
      updateOne: { filter: { _id: id }, update: { $setOnInsert: { _id: id, ...data } }, upsert: true },
    }));
    await col.bulkWrite(ops);
    console.log(`✅ Police records migrated: ${ops.length} records → police_${GUILD_ID}`);
  }

  // ── GANG WARS (per-server) ───────────────────────────────────
  const wars = readJSON('gangWars.json');
  if (wars && Object.keys(wars).length) {
    const col = db.collection(`gangWars_${GUILD_ID}`);
    const ops = Object.entries(wars).map(([id, data]) => ({
      updateOne: { filter: { _id: id }, update: { $setOnInsert: { _id: id, ...data } }, upsert: true },
    }));
    await col.bulkWrite(ops);
    console.log(`✅ Gang wars migrated: ${ops.length} records → gangWars_${GUILD_ID}`);
  }

  // ── BUSINESSES (global) ──────────────────────────────────────
  const businesses = readJSON('businesses.json');
  if (businesses && Object.keys(businesses).length) {
    const col = db.collection('businesses');
    const ops = Object.entries(businesses).map(([id, data]) => ({
      updateOne: { filter: { _id: id }, update: { $setOnInsert: { _id: id, ...data } }, upsert: true },
    }));
    await col.bulkWrite(ops);
    console.log(`✅ Businesses migrated: ${ops.length} records (global)`);
  }

  // ── ACTIVE EFFECTS (global) ──────────────────────────────────
  const effects = readJSON('activeEffects.json');
  if (effects && Object.keys(effects).length) {
    const col = db.collection('activeEffects');
    const ops = Object.entries(effects).map(([id, data]) => ({
      updateOne: { filter: { _id: id }, update: { $setOnInsert: { _id: id, ...data } }, upsert: true },
    }));
    await col.bulkWrite(ops);
    console.log(`✅ Active effects migrated: ${ops.length} records (global)`);
  }

  // ── AI ENTITIES (global) ─────────────────────────────────────
  const aiEntities = readJSON('aiEntities.json');
  if (aiEntities && Object.keys(aiEntities).length) {
    const col = db.collection('aiEntities');
    const ops = Object.entries(aiEntities).map(([id, data]) => ({
      updateOne: { filter: { _id: id }, update: { $setOnInsert: { _id: id, ...data } }, upsert: true },
    }));
    await col.bulkWrite(ops);
    console.log(`✅ AI entities migrated: ${ops.length} records (global)`);
  }

  // ── PETS (global) ────────────────────────────────────────────
  const pets = readJSON('pets.json');
  if (pets && Object.keys(pets).length) {
    const col = db.collection('pets');
    const ops = Object.entries(pets).map(([id, data]) => ({
      updateOne: { filter: { _id: id }, update: { $setOnInsert: { _id: id, ...data } }, upsert: true },
    }));
    await col.bulkWrite(ops);
    console.log(`✅ Pets migrated: ${ops.length} records (global)`);
  }

  // ── LOTTERY (per-server) ─────────────────────────────────────
  const lottery = readJSON('lottery.json');
  if (lottery) {
    const col = db.collection(`lottery_${GUILD_ID}`);
    await col.updateOne({ _id: 'lottery' }, { $setOnInsert: { _id: 'lottery', ...lottery } }, { upsert: true });
    console.log(`✅ Lottery migrated → lottery_${GUILD_ID}`);
  }

  // ── GUN INVENTORY (global) ───────────────────────────────────
  const guns = readJSON('guns.json');
  if (guns && Object.keys(guns).length) {
    const col = db.collection('gunInventory');
    const ops = Object.entries(guns).map(([id, guns]) => ({
      updateOne: { filter: { _id: id }, update: { $setOnInsert: { _id: id, guns } }, upsert: true },
    }));
    await col.bulkWrite(ops);
    console.log(`✅ Gun inventories migrated: ${ops.length} records (global)`);
  }

  // ── HEALTH (global) ──────────────────────────────────────────
  const health = readJSON('health.json');
  if (health && Object.keys(health).length) {
    const col = db.collection('health');
    const ops = Object.entries(health).map(([id, data]) => ({
      updateOne: { filter: { _id: id }, update: { $setOnInsert: { _id: id, ...data } }, upsert: true },
    }));
    await col.bulkWrite(ops);
    console.log(`✅ Health records migrated: ${ops.length} records (global)`);
  }

  await client.close();
  console.log('\n🎉 Migration complete! Your data is now in MongoDB.');
  console.log('You can now delete your data/*.json files if you want, but keep them as a backup for now.');
}

migrate().catch(err => { console.error('❌ Migration failed:', err); process.exit(1); });
