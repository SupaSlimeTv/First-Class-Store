const { col } = require('./mongo');

async function getRoutingNumber(userId) {
  const c   = await col('routingNumbers');
  const doc = await c.findOne({ _id: userId });
  if (doc) return doc.routing;
  const routing = 'FCS-' + Math.floor(10000000 + Math.random() * 90000000).toString();
  await c.insertOne({ _id: userId, routing, createdAt: Date.now() });
  return routing;
}

async function getUserByRouting(routing) {
  const c   = await col('routingNumbers');
  const doc = await c.findOne({ routing });
  return doc ? doc._id : null;
}

module.exports = { getRoutingNumber, getUserByRouting };
