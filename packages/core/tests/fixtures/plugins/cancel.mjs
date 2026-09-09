import { setTimeout as after } from 'node:timers/promises';

import { Application, FatalError, plugin, renderFailure } from '@loomcli/core';

import { callerReason, controller } from './caller.mjs';

/** How many listeners core holds on each claimed signal, read where a test wants the count. */
function counts(label) {
  return `${label}:${process.listenerCount('SIGINT')}:${process.listenerCount('SIGTERM')}`;
}

/** The reason core aborted with, as one line a test reads. */
function describe(reason) {
  return `${reason.source}:${reason.cause instanceof Error ? reason.cause.message : 'none'}`;
}

/**
 * Resolves once the run is cancelled, which is how a cooperative action reads the abort. A process
 * signal listener does not keep the runtime alive, so the wait holds one referenced timer.
 */
function cancelled(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const held = setTimeout(resolve, 20_000);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(held);
        resolve();
      },
      { once: true },
    );
  });
}

/** A module whose middleware announces that it ran, so a skipped entry leaves no line. */
const marking = () => import('./modules/cancelling.mjs');

const plugins = {
  /** Cancels the run from inside the chain, then takes over or continues the chain. */
  cancelling: () =>
    plugin('@fixture/cancelling', { middleware: { activate: 'always', load: marking } }),
  /** Claims the signals slot, and adds the synchronous abort listener the contract describes. */
  owner: () =>
    plugin('@fixture/owner', {
      middleware: { activate: 'always', load: () => import('./modules/watching.mjs') },
      signals: ['SIGINT', 'SIGTERM'],
    }),
  /** Its loader is still pending when the caller's abort lands, so its middleware is skipped. */
  pending: () =>
    plugin('@fixture/pending', {
      middleware: {
        activate: 'always',
        load: async () => {
          controller.abort(callerReason);
          await after(10);
          return marking();
        },
      },
    }),
  /** Announces the load itself, so a run that loads nothing leaves no line at all. */
  reporting: () =>
    plugin('@fixture/reporting', {
      middleware: {
        activate: 'always',
        load: () => {
          process.stdout.write('loader:called\n');
          return marking();
        },
      },
      signals: ['SIGINT', 'SIGTERM'],
    }),
  /** An always-on wrapper that reports the outcome its own `next()` resolved. */
  wrapper: () =>
    plugin('@fixture/wrapper', {
      middleware: { activate: 'always', load: () => import('./modules/outcome.mjs') },
    }),
};

/** What each scenario installs, in the order the chain composes them. */
const installed = {
  'abort-error': [],
  'broken-renderer': [],
  'caller-abort': [],
  'no-owner': [],
  owner: ['owner'],
  'pending-loader': ['pending'],
  'pre-aborted': ['reporting'],
  twice: ['owner'],
  wrapped: ['wrapper', 'cancelling'],
};

/** The scenarios whose run reads a caller-owned signal rather than a process signal. */
const callerSignal = new Set([
  'abort-error',
  'broken-renderer',
  'caller-abort',
  'pending-loader',
  'pre-aborted',
  'wrapped',
]);

/** The renderer a cancelled run meets when the scenario asks for a broken one. */
const registered = {
  'broken-renderer': () => [
    renderFailure(FatalError, {
      render: () => {
        throw new Error('the failure renderer could not answer');
      },
    }),
  ],
};

const scenario = process.argv[2];
const argv = process.argv.slice(3);

/** What one scenario's action throws after the run was cancelled, or nothing. */
function raise(out, signal) {
  if (process.env.LOOM_FIXTURE_THROW === 'reason') {
    throw signal.reason;
  }
  if (process.env.LOOM_FIXTURE_THROW === 'named') {
    throw Object.assign(new Error('the fetch was aborted'), { name: 'AbortError' });
  }
  if (process.env.LOOM_FIXTURE_THROW === 'fatal') {
    out.fatal('the action stopped the invocation');
  }
}

/** A cooperative action: it reports, waits for the abort it expects, and reports the reason. */
async function waiting({ out, signal }) {
  await out.print(counts('during'));
  if (callerSignal.has(scenario)) {
    controller.abort(callerReason);
  }
  await out.print('ready');
  await cancelled(signal);
  await out.print(`action:${describe(signal.reason)}`);
  raise(out, signal);
}

/** An action that never reads the signal, so only a repeated signal can end the process. */
async function ignoring({ out }) {
  await out.print(counts('during'));
  await out.print('ready');
  await after(20_000);
  await out.print('slept');
}

/** An action that runs to completion, for the scenarios that watch the listener bracket alone. */
async function finishing({ out }) {
  await out.print(counts('during'));
}

const actions = { finishing, ignoring, waiting };

function application() {
  return new Application('app', {
    failures: (registered[scenario] ?? (() => []))(),
    plugins: (installed[scenario] ?? []).map((name) => plugins[name]()),
  }).action(actions[process.env.LOOM_FIXTURE_ACTION ?? 'waiting']);
}

/** The run options one scenario supplies, which is where a caller-owned signal enters. */
function options() {
  const host = { argv };
  return callerSignal.has(scenario) ? { host, signal: controller.signal } : { host };
}

process.stdout.write(`${counts('before')}\n`);

if (scenario === 'pre-aborted') {
  controller.abort(callerReason);
  const code = await application().run(options());
  process.stdout.write(`${counts('after')}\n`);
  process.stdout.write(`resolved:${code}\n`);
} else if (scenario === 'twice') {
  // One Application, run twice, so each run installs its own listeners and removes them.
  const app = application();
  const first = await app.run({ host: { argv } });
  process.stdout.write(`${counts('between')}\n`);
  const second = await app.run({ host: { argv } });
  process.stdout.write(`${counts('after')}\n`);
  process.stdout.write(`resolved:${first}:${second}\n`);
} else {
  const code = await application().run(options());
  process.stdout.write(`${counts('after')}\n`);
  process.stdout.write(`resolved:${code}\n`);
}
