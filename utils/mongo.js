// ============================================================
// utils/mongo.js — Shared MongoDB Connection
// Global collections: users, gunInventory, health, pets,
//                     aiEntities, businesses, activeEffects,
//                     store, gunShop
// Per-server collections: config_{guildId}, gangs_{guildId},
//                          police_{guildId}, gangWars_{guildId},
//                          lottery_{guildId}
// ============================================================

const { MongoClient } = require('mongodb');

const URI = process.env.MONGODB_URI;
if (!URI) throw new Error('MONGODB_URI is not set in your .env file!');

const client = new MongoClient(URI);
let db = null;

async function connect() {
  if (db) return db;
  await client.connect();
  db = client.db();
  console.log('✅ Connected to MongoDB');
  return db;
}

// Global collection (no guild scope)
async function col(name) {
  const database = await connect();
  return database.collection(name);
}

// Per-server collection (scoped to a guild)
async function guildCol(name, guildId) {
  if (!guildId) throw new Error(`guildCol called without guildId for collection: ${name}`);
  const database = await connect();
  return database.collection(`${name}_${guildId}`);
}

module.exports = { connect, col, guildCol };
