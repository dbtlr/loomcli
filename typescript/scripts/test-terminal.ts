import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { childEnvironment } from './test-process.js';

/**
 * Drives real terminal input and captures frames without depending on a screen emulator. The
 * command runs on a pseudo-terminal in `options.cwd`, which is the working directory by default.
 */
export function drive(
  command: string[],
  env: Record<string, string> = {},
  options: { cwd?: string } = {},
) {
  const driver = spawn(
    'zsh',
    [fileURLToPath(new URL('zpty-driver.zsh', import.meta.url)), ...command],
    {
      cwd: options.cwd,
      env: childEnvironment({ TERM: 'xterm-256color', ...env }),
      timeout: 20_000,
    },
  );
  let output = '';
  let error = '';
  driver.stdin.on('error', (cause) => {
    error += String(cause);
  });
  const waiters: (() => void)[] = [];
  driver.stdout.setEncoding('utf8');
  driver.stderr.setEncoding('utf8');
  driver.stdout.on('data', (chunk: string) => {
    output += chunk;
    for (const waiter of waiters.splice(0)) {
      waiter();
    }
  });
  driver.stderr.on('data', (chunk: string) => {
    error += chunk;
  });
  let ended = false;
  const exit = new Promise<void>((resolve) => {
    driver.on('close', () => {
      ended = true;
      for (const waiter of waiters.splice(0)) {
        waiter();
      }
      resolve();
    });
  });
  return {
    async close() {
      if (!ended && !driver.stdin.destroyed) {
        driver.stdin.end('quit\n');
      }
      await exit;
    },
    async expect(pattern: string) {
      const start = output.length;
      driver.stdin.write(`expect ${pattern}\n`);
      while (!output.slice(start).includes('@@END@@')) {
        if (
          ended ||
          output.slice(start).includes('@@TIMEOUT@@') ||
          output.slice(start).includes('@@EXITED@@')
        ) {
          throw new Error(`Terminal did not reach ${pattern}: ${output}\n${error}`);
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      return output.slice(start);
    },
    send(keys: string) {
      driver.stdin.write(`send ${keys}\n`);
    },
  };
}
