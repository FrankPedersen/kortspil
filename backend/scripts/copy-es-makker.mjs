import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const source = resolve(repositoryRoot, 'es-makker');
const destination = resolve(scriptDirectory, '../public/es-makker');

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(resolve(source, 'index.html'), resolve(destination, 'index.html'));
cpSync(resolve(source, 'css'), resolve(destination, 'css'), { recursive: true });
cpSync(resolve(source, 'js'), resolve(destination, 'js'), { recursive: true });
