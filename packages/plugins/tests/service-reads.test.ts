// Acceptance plan: see packages/plugins/tests/service.test.ts.

import type { Child, ChildExit, Host } from '@loomcli/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { readCall, readLimit } from '../src/service/manager.js';
import type { Call, Manager } from '../src/service/manager.js';

const call: Call = { args: ['--user', 'show'], program: 'systemctl', report: 'systemctl status' };

const noOutput = { bytes: new Uint8Array(), text: '' };

/** An exit of `code` with `stdout`. */
function exitOf(code: number, stdout = ''): ChildExit {
  return {
    code,
    kind: 'exited',
    stderr: noOutput,
    stdout: { bytes: new TextEncoder().encode(stdout), text: stdout },
  };
}

/** The signals a fake child received. */
interface Fake {
  readonly kills: string[];
  readonly manager: Manager;
  readonly shutdown: { handlers: (() => void)[]; removed: number };
}

/**
 * A manager whose one child ignores `SIGTERM`, as a hung manager can: the spawn's signal ends it
 * with 143 only when `terminates` is set, and only `SIGKILL` ends it otherwise. `answer` is the exit
 * it gives on its own.
 */
function fakeManager(options: {
  readonly signal: AbortSignal;
  readonly terminates?: boolean;
  readonly answer?: ChildExit;
}): Fake {
  const kills: string[] = [];
  const shutdown = { handlers: [] as (() => void)[], removed: 0 };
  const spawn: Host['spawn'] = (_program, _args, spawnOptions) => {
    const { promise: exited, resolve: settle } = Promise.withResolvers<ChildExit>();
    if (options.answer !== undefined) {
      settle(options.answer);
    }
    if (options.terminates === true) {
      const spawnSignal =
        spawnOptions !== undefined && 'signal' in spawnOptions ? spawnOptions.signal : undefined;
      spawnSignal?.addEventListener('abort', () => settle(exitOf(143)), { once: true });
    }
    const child: Child = {
      exited,
      kill: (signal = 'SIGTERM') => {
        kills.push(signal);
        if (signal === 'SIGKILL') {
          settle(exitOf(137));
        }
      },
    };
    return child;
  };
  const manager: Manager = {
    env: {},
    name: 'notes',
    onShutdown: (handler) => {
      const handle = () => {
        handler({ cause: 'SIGTERM', code: 143 });
      };
      shutdown.handlers.push(handle);
      return () => {
        shutdown.removed += 1;
      };
    },
    signal: options.signal,
    spawn,
  };
  return { kills, manager, shutdown };
}

describe('a status read', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is fixed at 5 seconds', () => {
    expect(readLimit).toBe(5000);
  });

  it('ends with SIGKILL at the limit and answers that it ran out, whatever the manager does with SIGTERM', async () => {
    const { kills, manager } = fakeManager({ signal: new AbortController().signal });
    const pending = readCall(manager, call);
    await vi.advanceTimersByTimeAsync(readLimit - 1);
    expect(kills).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ kind: 'timedOut' });
    expect(kills).toEqual(['SIGKILL']);
  });

  it('answers a read that exits 143 on its own as an exit, not as one that ran out', async () => {
    const { kills, manager } = fakeManager({
      answer: exitOf(143),
      signal: new AbortController().signal,
    });
    await expect(readCall(manager, call)).resolves.toEqual({
      code: 143,
      kind: 'exited',
      stdout: '',
    });
    expect(kills).toEqual([]);
  });

  it('answers a read that exits before the limit, and leaves no timer running', async () => {
    const { manager } = fakeManager({
      answer: exitOf(0, 'ActiveState=active\n'),
      signal: new AbortController().signal,
    });
    await expect(readCall(manager, call)).resolves.toEqual({
      code: 0,
      kind: 'exited',
      stdout: 'ActiveState=active\n',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('throws the run signal reason when the run is cancelled during the read, not a timeout', async () => {
    const controller = new AbortController();
    const { manager } = fakeManager({ signal: controller.signal, terminates: true });
    const pending = readCall(manager, call);
    const reason = new Error('The run was cancelled.');
    const outcome = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(readLimit - 1);
    controller.abort(reason);
    await expect(outcome).resolves.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is killed with SIGKILL by the shutdown handler while it runs, and the handler is removed after', async () => {
    const { kills, manager, shutdown } = fakeManager({ signal: new AbortController().signal });
    const pending = readCall(manager, call);
    expect(shutdown.handlers).toHaveLength(1);
    shutdown.handlers[0]?.();
    expect(kills).toEqual(['SIGKILL']);
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(shutdown.removed).toBe(1);
  });

  it('answers a program that cannot start as missing', async () => {
    const error = new Error('spawn systemctl ENOENT');
    const { manager } = fakeManager({
      answer: { error, kind: 'unstarted' },
      signal: new AbortController().signal,
    });
    await expect(readCall(manager, call)).resolves.toEqual({ error, kind: 'missing' });
  });
});
