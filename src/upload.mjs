import {isAbsolute} from 'node:path';
import {realpathSync, statSync, accessSync, constants} from 'node:fs';

// Validate on the native host, where the browser's local filesystem lives.
export function localFiles(files) {
  return files.map(file => {
    if (!isAbsolute(file) || file.includes('\0') || /^(\\\\|\/\/)/.test(file)) throw new Error('Se requiere una ruta absoluta local, no una ruta de red');
    const path = realpathSync(file);
    if (/^(\\\\|\/\/)/.test(path) || !statSync(path).isFile()) throw new Error('Se requiere un archivo local regular');
    accessSync(path, constants.R_OK);
    return path;
  });
}
