import {spawn} from 'node:child_process';
import {join} from 'node:path';

export function writeClipboard(text) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Clipboard paste requires Windows'));
  return new Promise((resolve, reject) => {
    const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const command = '$ErrorActionPreference="Stop"; [Console]::InputEncoding = [Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())';
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', command], {windowsHide: true, stdio: ['pipe', 'ignore', 'pipe']});
    let finished = false;
    const timer = setTimeout(() => {finish(new Error('Timed out while setting the clipboard')); child.kill();}, 5000);
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    }
    child.on('error', () => finish(new Error('Could not open the Windows clipboard')));
    child.on('close', code => finish(code === 0 ? undefined : new Error('Could not write to the Windows clipboard')));
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.stdin.end(text, 'utf8');
  });
}
