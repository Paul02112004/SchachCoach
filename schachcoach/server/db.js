// Ablage der Partien und Einstellungen als JSON-Dateien in ./data
import { readFile, writeFile, mkdir, unlink, rename } from 'node:fs/promises';
import path from 'node:path';

export function createDb(dataDir) {
  const GAMES = path.join(dataDir, 'games');
  const INDEX = path.join(dataDir, 'games-index.json');
  let index = null;
  let lock = Promise.resolve();
  const serial = fn => { const p = lock.then(fn); lock = p.catch(() => {}); return p; };

  async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }
  async function writeJson(file, data) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    await writeFile(tmp, typeof data === 'string' ? data : JSON.stringify(data));
    await rename(tmp, file);
  }
  async function loadIndex() { if (!index) index = await readJson(INDEX, []); return index; }

  return {
    readJson, writeJson,
    async listGames() { return loadIndex(); },
    async hasGame(id) { return (await loadIndex()).some(g => g.id === id); },
    async ids() { return new Set((await loadIndex()).map(g => g.id)); },
    async getGame(id) { return readJson(path.join(GAMES, id + '.json'), null); },
    saveGame: (id, game, raw) => serial(async () => {
      await writeJson(path.join(GAMES, id + '.json'), raw ?? game);
      const list = (await loadIndex()).filter(x => x.id !== id);
      list.push(game.summary ? { ...game.summary, id } : { id });
      list.sort((a, b) => (b.date || 0) - (a.date || 0));
      index = list;
      await writeJson(INDEX, list);
    }),
    deleteGame: id => serial(async () => {
      try { await unlink(path.join(GAMES, id + '.json')); } catch {}
      index = (await loadIndex()).filter(x => x.id !== id);
      await writeJson(INDEX, index);
    }),
    getKv: key => readJson(path.join(dataDir, 'kv-' + key + '.json'), null),
    setKv: (key, value) => writeJson(path.join(dataDir, 'kv-' + key + '.json'), value),
  };
}
