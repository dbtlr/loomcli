import { provider } from '@loomcli/core';
import type { Opener, Provider } from '@loomcli/core';
import { describe, expect, it } from 'vite-plus/test';

import { providerContext } from '../src/index.js';

interface Pool {
  readonly url: string;
}

interface Session {
  readonly pool: Pool;
  readonly token: string | undefined;
}

declare const openPool: Opener<typeof pool>;

const pool: Provider<'pool', Pool, {}, 'persistent'> = provider('pool', {
  lifetime: 'persistent',
  load: async () => ({ default: openPool }),
});

const session: Provider<
  'session',
  Session,
  { token: string | undefined },
  'ephemeral',
  [typeof pool]
> = provider('session', { load: async () => ({ default: open }), uses: [pool] });

/** Starts a session on the pool with the token option. */
const open: Opener<typeof session> = ({ options, provided }) => ({
  pool: provided.pool,
  token: options.token,
});

describe('providerContext', () => {
  it('the opener reads the options and provided values the test stated', async () => {
    const testPool = { url: 'postgres://loom-test' };
    const context = providerContext(open, {
      options: { token: 't0k3n' },
      provided: { pool: testPool },
    });
    const opened = await open(context);
    expect(opened).toEqual({ pool: testPool, token: 't0k3n' });
    expect(context.provided.pool).toBe(testPool);
  });

  it('an unstated host throws its sentence when read', () => {
    const context = providerContext(open, {
      options: { token: undefined },
      provided: { pool: { url: '' } },
    });
    expect(() => context.host).toThrow(
      new Error('providerContext has no host. Add host to its values.'),
    );
  });

  it('answers out, style, and onShutdown with inert members, and asks for the graph', async () => {
    const context = providerContext(open, {
      options: { token: undefined },
      provided: { pool: { url: '' } },
    });
    await expect(context.out.warn('Skipped.')).resolves.toBeUndefined();
    expect(context.style.red('text')).toBe('text');
    expect(() => context.graph).toThrow(
      new Error('providerContext has no graph. Add graph to its values.'),
    );
  });

  it('keeps the out member the test states and the inert rest', async () => {
    const lines: string[] = [];
    const context = providerContext(open, {
      options: { token: undefined },
      out: {
        warn: async (message) => {
          lines.push(message);
        },
      },
      provided: { pool: { url: '' } },
    });
    await context.out.warn('Loud.');
    await context.out.debug('Quiet.');
    expect(lines).toEqual(['Loud.']);
  });
});
