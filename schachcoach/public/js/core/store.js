// Zugriff auf den lokalen Server (Speicher + Proxy)
const j = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) {
    let msg = r.status + ' ' + r.statusText;
    try { const b = await r.json(); if (b.error) msg = b.error; else if (b.message) msg = b.message; } catch {}
    throw new Error(msg);
  }
  return r.json();
};
const put = (url, data) => j(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const store = {
  listGames: () => j('/api/games'),
  getGame: id => j('/api/games/' + encodeURIComponent(id)),
  saveGame: g => put('/api/games/' + encodeURIComponent(g.id), g),
  deleteGame: id => j('/api/games/' + encodeURIComponent(id), { method: 'DELETE' }),
  getKv: k => j('/api/kv/' + k),
  setKv: (k, v) => put('/api/kv/' + k, v),
};

export const DEFAULT_SETTINGS = { chesscom: '', lichess: '', depth: 14, historyDepth: 12, workers: 0, batchSize: 25, autoSync: true, syncMinutes: 10, fullHistory: false };
let settingsCache = null;
export async function getSettings() {
  if (!settingsCache) settingsCache = { ...DEFAULT_SETTINGS, ...(await store.getKv('settings') || {}) };
  return settingsCache;
}
export async function saveSettings(s) {
  // mit dem aktuellen Stand des Servers zusammenführen (der Server ändert z.B. fullHistory)
  settingsCache = { ...DEFAULT_SETTINGS, ...(await store.getKv('settings') || {}), ...s };
  await store.setKv('settings', settingsCache);
}
export function invalidateSettings() { settingsCache = null; }

/** Liste der eigenen Benutzernamen (klein geschrieben) */
export async function myNames() {
  const s = await getSettings();
  return [s.chesscom, s.lichess].filter(Boolean).map(x => x.toLowerCase());
}
