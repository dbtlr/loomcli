import { Readable } from 'node:stream';

import { Application, Command } from '@loomcli/core';
import type { ActionHandler, Content, Host } from '@loomcli/core';
import { describe, expect, it, vi } from 'vite-plus/test';

import { actionContext, mockProcess } from '../src/index.js';

const get = new Command('get')
  .argument('path', { required: true })
  .option('verbose', { type: 'count' });

/** An extracted handler, as an author writes one to unit-test it. */
const getValue: ActionHandler<typeof get> = async ({ args, out }) => {
  await out.print(args.path);
};

const read = new Command('read').stdin({ required: true });

const readInput: ActionHandler<typeof read> = async ({ out, stdin }) => {
  await out.print(await stdin.text());
};

describe('actionContext', () => {
  it('the handler reads the inputs the test stated, as it stated them', async () => {
    const print = vi.fn(async (_message: string) => {});
    const args = { path: 'name' };
    const options = { verbose: 2 };
    const provided = {};
    const context = actionContext(getValue, { args, options, out: { print }, provided });
    await getValue(context);
    expect(print).toHaveBeenCalledWith('name');
    expect(context.args).toBe(args);
    expect(context.options).toBe(options);
    expect(context.provided).toBe(provided);
  });

  it('a required stdin is the Content the test wrote', async () => {
    const print = vi.fn(async (_message: string) => {});
    const stdin: Content = {
      kind: 'stdin',
      name: 'stdin',
      path: undefined,
      stream: () => Readable.from(['{}']),
      text: async () => '{}',
    };
    const context = actionContext(readInput, {
      args: {},
      options: {},
      out: { print },
      provided: {},
      stdin,
    });
    await readInput(context);
    expect(context.stdin).toBe(stdin);
    expect(print).toHaveBeenCalledWith('{}');
  });

  it('a stated member replaces the builder whole', () => {
    const controller = new AbortController();
    const cancel = (): void => {
      controller.abort();
    };
    const context = actionContext(getValue, {
      args: { path: 'name' },
      cancel,
      options: { verbose: 0 },
      provided: {},
      signal: controller.signal,
    });
    context.cancel();
    expect(context.signal.aborted).toBe(true);
  });

  it('an unstated invoke rejects with a sentence naming the path', async () => {
    const context = actionContext(getValue, {
      args: { path: 'name' },
      options: { verbose: 0 },
      provided: {},
    });
    await expect(context.invoke(['remote', 'sync'], {})).rejects.toThrow(
      new Error(
        `actionContext has no invoke for "remote sync". Add invoke to its values, such as invoke: async () => ({ status: 'completed', output: '', messages: '' }).`,
      ),
    );
  });

  it('a stated invoke answers the outcome the test chose', async () => {
    const invoke = vi.fn(
      async (): Promise<{
        readonly status: 'completed';
        readonly output: string;
        readonly messages: string;
      }> => ({ messages: '', output: 'synced\n', status: 'completed' }),
    );
    const context = actionContext(getValue, {
      args: { path: 'name' },
      invoke,
      options: { verbose: 0 },
      provided: {},
    });
    await expect(context.invoke(['sync'], {})).resolves.toEqual({
      messages: '',
      output: 'synced\n',
      status: 'completed',
    });
  });

  it('a handler may assign an unstated passthrough, as its context types it', () => {
    const context = actionContext(getValue, {
      args: { path: 'name' },
      options: { verbose: 0 },
      provided: {},
    });
    context.passthrough = ['--', 'rest'];
    expect(context.passthrough).toEqual(['--', 'rest']);
  });

  it('a handler may assign an unstated host, as its context types it', async () => {
    const hosts: Host[] = [];
    await new Application('app')
      .action(({ host }) => {
        hosts.push(host);
      })
      .run({ process: mockProcess({ argv: [] }) });
    const [host] = hosts;
    if (host === undefined) {
      throw new TypeError('The run did not reach its action.');
    }
    const context = actionContext(getValue, {
      args: { path: 'name' },
      options: { verbose: 0 },
      provided: {},
    });
    context.host = host;
    expect(context.host).toBe(host);
  });
});
