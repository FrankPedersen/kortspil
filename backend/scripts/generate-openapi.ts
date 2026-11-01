import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';

const app = await buildApp();
try {
  await app.ready();
  const outputPath = fileURLToPath(new URL('../../contracts/openapi.json', import.meta.url));
  await writeFile(outputPath, `${JSON.stringify(app.swagger(), null, 2)}\n`, 'utf8');
} finally {
  await app.close();
}
