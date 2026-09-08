import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { git, readRegularFile } from './repository.js';

export function runProcess(root: string, command: string, args: string[], env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 600_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

export function pnpmExecutable() {
  const path = fileURLToPath(import.meta.resolve('pnpm/package.json'));
  const directory = dirname(path);
  const manifest = z
    .object({ bin: z.object({ pnpm: z.string() }) })
    .parse(JSON.parse(readRegularFile(directory, 'package.json')));
  return join(directory, manifest.bin.pnpm);
}

export function checkoutSource(root: string, source: string, destination: string) {
  git(root, ['clone', '--no-hardlinks', '--no-checkout', '--', root, destination]);
  git(destination, ['checkout', '--detach', source]);
}

export function pnpm(root: string, args: string[], env = process.env) {
  return runProcess(root, pnpmExecutable(), args, env);
}
