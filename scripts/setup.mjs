import {generateKeyPairSync, createHash, randomBytes} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
if (process.platform !== 'win32') throw new Error('The initial setup requires Windows');
const root = fileURLToPath(new URL('../', import.meta.url));
const local = resolve(root, '.local');
mkdirSync(local, {recursive: true});
const manifestPath = resolve(root, 'extension/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath));
if (!manifest.key) {
  const {publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  manifest.key = publicKey.export({type: 'spki', format: 'der'}).toString('base64');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
const extensionId = [...digest].map(x => String.fromCharCode(97 + parseInt(x, 16))).join('');
const configPath = resolve(local, 'config.json');
if (!existsSync(configPath)) writeFileSync(configPath, JSON.stringify({pipe: `\\\\.\\pipe\\local-browser-${extensionId}`, token: randomBytes(32).toString('hex')}, null, 2));
const launcher = resolve(local, 'native-host.cmd');
writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${resolve(root, 'src/native-host.mjs')}"\r\n`);
const nativeManifest = resolve(local, 'native-host.json');
writeFileSync(nativeManifest, JSON.stringify({name: 'local.browser.bridge', description: 'Local browser native bridge', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`]}, null, 2));
execFileSync('reg.exe', ['add', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\local.browser.bridge', '/ve', '/t', 'REG_SZ', '/d', nativeManifest, '/f'], {stdio: 'pipe'});
console.log(`Local setup ready.\nExtension: ${resolve(root, 'extension')}\nID: ${extensionId}\nMCP server: ${resolve(root, 'src/mcp.mjs')}`);
