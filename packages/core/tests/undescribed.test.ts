import { Writable } from 'node:stream';

import { expect, test, vi } from 'vite-plus/test';

import { Application, Command, processHandle } from '../src/index.js';

/** An Application, a Command, an option, and an argument, none of them described. */
const app = new Application('store').command(
  new Command('get')
    .argument('path', { required: true })
    .option('raw', { type: 'boolean' })
    .action(({ args, out }) => out.print(args.path)),
);

const release = { build: 'development' } as const;

test('a development run and app.invoke() run a graph with an undescribed Command, option, and argument, and check() reports no fault', async () => {
  const written: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      written.push(String(chunk));
      done();
    },
  });
  const stderr = vi.spyOn(process.stderr, 'write');
  try {
    const code = await app.run({
      process: processHandle({ argv: ['get', 'name'], release, stdout }),
    });
    const outcome = await app.invoke(
      ['get'],
      { args: { path: 'other' } },
      { process: processHandle({ release }) },
    );
    expect(code).toBe(0);
    expect(written.join('')).toBe('name\n');
    expect(outcome.status).toBe('completed');
    expect(app.check()).toEqual([]);
    expect(stderr).not.toHaveBeenCalled();
  } finally {
    stderr.mockRestore();
  }
});
