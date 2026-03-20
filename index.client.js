// Shared bot client reference — lets dashboard/server.js send Discord messages
let _client = null;
module.exports = {
  set: (c) => { _client = c; },
  get: ()    => _client,
  // Make it callable directly like require('./index.client')
  then: undefined,
  channels: new Proxy({}, { get: (_, k) => _client ? _client.channels[k] : null }),
};
// Allow both require('./index.client').channels.fetch() and the pattern in server.js
module.exports = new Proxy(module.exports, {
  get: (target, key) => {
    if (key in target) return target[key];
    if (_client && key in _client) return typeof _client[key] === 'function' ? _client[key].bind(_client) : _client[key];
    return undefined;
  }
});
