// Parses `player_state`, sent while the player moves. path.speed is in px/s,
// the same unit Gauntlet Lab uses for movement_speed.

// The server sends player_state for every nearby player, so callers must pass
// their own playerId.

/** Returns { movementSpeed?, totalLevel?, lifeLevel? } for `playerId` from a raw WS payload, or null. */
export function extractPlayerState(payload, playerId) {
  let msg;
  try { msg = typeof payload === "string" ? JSON.parse(payload) : payload; } catch { return null; }
  const messages = msg?.type === "batch" && Array.isArray(msg.data) ? msg.data : [msg];
  let found = null;
  for (const m of messages) {
    if (m?.type !== "player_state" || !m.data || m.data.playerId !== playerId) continue;
    const d = m.data;
    found = {};
    if (Number.isFinite(d.path?.speed)) found.movementSpeed = d.path.speed;
    if (Number.isFinite(d.totalLevel)) found.totalLevel = d.totalLevel;
    if (Number.isFinite(d.lifeLevel)) found.lifeLevel = d.lifeLevel;
  }
  return found;
}
