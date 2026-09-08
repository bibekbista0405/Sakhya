import { rm } from 'node:fs/promises';
import path from 'node:path';

const nextDir = path.join(process.cwd(), '.next');

try {
  await rm(nextDir, { recursive: true, force: true });
  console.log('[Sakhya] Cleaned client/.next before development start.');
} catch (error) {
  console.error('[Sakhya] Could not clean client/.next:', error);
  process.exit(1);
}
