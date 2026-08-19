import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const binary = path.join(directory, '.qiantie-backend-server');
const child = spawn(binary, [], { cwd: directory, env: process.env, stdio: 'inherit' });

child.once('error', error => {
  console.error(`Unable to start qiantie backend: ${error.message}`);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  if (signal) console.error(`Qiantie backend stopped by ${signal}`);
  process.exit(code ?? 1);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => child.kill(signal));
}
