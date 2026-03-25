// utils/debitDb.js — Debit Card System
// Linked to bank account. Card number can be stolen by hackers.
const { col } = require('./mongo');

let _debitCards = {}; // userId -> { cardNumber, pin, frozen, lastUsed }

function generateCardNumber() {
  const seg = () => String(Math.floor(1000 + Math.random() * 9000));
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}
function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function preloadDebitCache() {
  try {
    const c = await col('debitCards');
    const docs = await c.find({}).toArray();
    for (const d of docs) { const id = d._id; const o = {...d}; delete o._id; _debitCards[id] = o; }
    console.log(`💳 Debit cache loaded (${Object.keys(_debitCards).length} cards)`);
  } catch(e) { console.error('preloadDebitCache error:', e.message); }
}

function getDebitCard(userId) { return _debitCards[userId] || null; }

async function createDebitCard(userId) {
  const card = {
    cardNumber: generateCardNumber(),
    pin:        generatePin(),
    frozen:     false,
    createdAt:  Date.now(),
    lastUsed:   null,
    transactions: [],
  };
  _debitCards[userId] = card;
  try { const c = await col('debitCards'); await c.replaceOne({ _id:userId }, { _id:userId, ...card }, { upsert:true }); } catch {}
  return card;
}

async function saveDebitCard(userId, data) {
  _debitCards[userId] = data;
  try { const c = await col('debitCards'); await c.replaceOne({ _id:userId }, { _id:userId, ...data }, { upsert:true }); } catch {}
}

function getUserByCardNumber(cardNumber) {
  for (const [uid, card] of Object.entries(_debitCards)) {
    if (card.cardNumber === cardNumber) return uid;
  }
  return null;
}

module.exports = { preloadDebitCache, getDebitCard, createDebitCard, saveDebitCard, getUserByCardNumber };
