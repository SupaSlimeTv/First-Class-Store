// Shared in-memory state for Illuminati market override operations.
// tickStockPrices reads this each tick; operations write to it.
const _state = {
  driftBoost: null,  // { direction: 1|-1, multiplier, until }
  volBoost:   null,  // { multiplier, until }
};

function getMarketOverride() {
  const now = Date.now();
  if (_state.driftBoost?.until < now) _state.driftBoost = null;
  if (_state.volBoost?.until   < now) _state.volBoost   = null;
  return { driftBoost: _state.driftBoost, volBoost: _state.volBoost };
}

function setDriftBoost(direction, multiplier, durationMs) {
  _state.driftBoost = { direction, multiplier, until: Date.now() + durationMs };
}

function setVolBoost(multiplier, durationMs) {
  _state.volBoost = { multiplier, until: Date.now() + durationMs };
}

module.exports = { getMarketOverride, setDriftBoost, setVolBoost };
