import {readFileSync} from 'node:fs';
export const configPath = new URL('../.local/config.json', import.meta.url);
export function config() {
  try { return JSON.parse(readFileSync(process.env.DIALBOT_CONFIG ?? configPath, 'utf8')); }
  catch { throw new Error('Run npm run setup before connecting.'); }
}
