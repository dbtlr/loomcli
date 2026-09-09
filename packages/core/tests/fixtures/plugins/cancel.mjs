import { Writable } from 'node:stream';
import { setTimeout as after } from 'node:timers/promises';

import { Application, FatalError, plugin, renderFailure } from '@loomcli/core';

import { callerReason, controller } from './caller.mjs';

/** How many listeners core holds on each claimed signal, read where a test wants the count. */
function counts(label) {
  return `${label}:${process.listenerCount('SIGINT')}:${process.listenerCount('SIGTERM')}`;
}

/**
 * Watches every signal listener added while it is armed, whatever removed it afterward, so a run
 * that installs none reads `added:none` where a count taken after the run could not tell.
 */
function probeSignals() {
  const added = [];
  const probe = (name) => {
    if (name === 'SIGINT' || name === 'SIGTERM') {
      added.push(name);
    }
  };
  process.on('newListener', probe);
  return () => {
    process.off('newListener', probe);
    return `added:${added.length > 0 ? added.join(',') : 'none'}`;
  };
}

/** A destination that refuses every write, which core meets on its way out of a failed run. */
function hostile() {
  return new Writable({
    write(chunk, encoding, callback) {
      callback(new Error('the destination refused the write'));
    },
  });
}

/**
 * A destination that delivers at once and reports completion late, so the last write of an action
 * is still flushing while core settles output and a signal can land in that window.
 */
function slow(delay) {
  return new Writable({
    write(chunk, encoding, callback) {
      process.stdout.write(chunk);
      setTimeout(callback, delay);
    },
  });
}

/** A schema that rejects whatever it is given, so a declared default fails after the graph built. */
const rejecting = {
  '~standard': {
    validate: () => ({ issues: [{ message: 'Supply a level the schema accepts.' }] }),
    vendor: 'fixture',
    version: 1,
  },
};

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
  /** Claims the slot and nothing else, for a scenario that watches the listener bracket alone. */
  bracket: () => plugin('@fixture/bracket', { signals: ['SIGINT', 'SIGTERM'] }),
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
  /** A second claimant on the signals slot, which is a declaration fault the build reports. */
  trace: () => plugin('@acme/trace', { signals: ['SIGINT'] }),
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
  'build-fault': ['owner', 'trace'],
  'caller-abort': [],
  'caller-then-signal': ['owner'],
  'default-fault': ['owner'],
  'first-cause': ['owner'],
  'hostile-stderr': ['owner'],
  'no-owner': [],
  'not-a-signal': ['owner'],
  'not-a-signal-host': ['owner'],
  owner: ['owner'],
  'pending-loader': ['pending'],
  'pre-aborted': ['reporting'],
  'slow-flush': ['owner'],
  twice: ['owner'],
  'two-runs': ['bracket'],
  wrapped: ['wrapper', 'cancelling'],
};

/** The scenarios whose run reads a caller-owned signal rather than a process signal. */
const callerSignal = new Set([
  'abort-error',
  'broken-renderer',
  'caller-abort',
  'caller-then-signal',
  'first-cause',
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

/** An action that fails, so core reports to the host's stderr on its way out of the run. */
async function refusing({ out }) {
  await out.print(counts('during'));
  out.fatal('the action stopped the invocation');
}

/**
 * The first cause fixes the reason and the code. This action waits for the signal the test sends,
 * then aborts the caller well after it, so a reason that moved would be the one it reads back.
 */
async function racing({ out, signal }) {
  await out.print(counts('during'));
  await out.print('ready');
  await cancelled(signal);
  await after(100);
  controller.abort(callerReason);
  await after(10);
  await out.print(`action:${describe(signal.reason)}`);
}

/** Resolves when the embedding host's own listener sees a signal core re-raised. */
let absorbed = () => undefined;
const embedded = new Promise((resolve) => {
  absorbed = resolve;
});

/**
 * The caller cancels first, so the process signal that follows is the force path. An embedding
 * host's own listener absorbs both the signal and the re-raise, so the process survives them.
 */
async function absorbing({ out, signal }) {
  await out.print(counts('during'));
  controller.abort(callerReason);
  await cancelled(signal);
  process.on('SIGINT', absorbed);
  await out.print('ready');
  // A referenced timer keeps the process alive while it waits, because signal listeners alone do not.
  // It is cancelled once the listener fires, so the process ends with the run rather than with it.
  const hold = new AbortController();
  await Promise.race([embedded, after(20_000, undefined, { signal: hold.signal })]);
  hold.abort();
  // A grace after the first absorb, so the re-raise that follows it lands before the run ends.
  await after(50);
  await out.print(`action:${describe(signal.reason)}`);
}

/**
 * The action prints and returns while its last write is still flushing, so the signal the test
 * sends next is the run's first, and it arrives once the chain has settled.
 */
async function flushing({ out }) {
  await out.print(counts('during'));
  void out.print('ready');
}

const actions = { absorbing, finishing, flushing, ignoring, racing, refusing, waiting };

function application() {
  const declared = new Application('app', {
    failures: (registered[scenario] ?? (() => []))(),
    plugins: (installed[scenario] ?? []).map((name) => plugins[name]()),
  });
  // A declared default its schema rejects is the one build rule that runs after the graph is built.
  const withDefault =
    scenario === 'default-fault'
      ? declared.option('level', { default: 'loud', type: 'string', validate: rejecting })
      : declared;
  return withDefault.action(actions[process.env.LOOM_FIXTURE_ACTION ?? 'waiting']);
}

/** The host one scenario runs under, which is where a refusing or a slow destination enters. */
function hostOf() {
  if (scenario === 'hostile-stderr') {
    return { argv, stderr: hostile() };
  }
  if (scenario === 'slow-flush') {
    return { argv, stdout: slow(800) };
  }
  return { argv };
}

/** The run options one scenario supplies, which is where a caller-owned signal enters. */
function options() {
  const host = hostOf();
  if (scenario === 'not-a-signal') {
    // A JavaScript caller reaches the slot with any value, so core answers for the value itself.
    return { host, signal: 'not a signal' };
  }
  return callerSignal.has(scenario) ? { host, signal: controller.signal } : { host };
}

process.stdout.write(`${counts('before')}\n`);

if (scenario === 'pre-aborted') {
  controller.abort(callerReason);
  const read = probeSignals();
  const code = await application().run(options());
  process.stdout.write(`${read()}\n`);
  process.stdout.write(`${counts('after')}\n`);
  process.stdout.write(`resolved:${code}\n`);
} else if (scenario === 'build-fault' || scenario === 'default-fault') {
  // A run that fails before the chain starts installs no listener at all, whichever rule failed.
  const read = probeSignals();
  const code = await application().run(options());
  process.stdout.write(`${read()}\n`);
  process.stdout.write(`resolved:${code}\n`);
} else if (scenario === 'two-runs') {
  /**
   * Run A owns the slot. A synchronous listener on its own abort starts run B, which claims the
   * slot in its turn, so both runs hold listeners when the second signal arrives.
   */
  const holding = async ({ out }) => {
    await out.print(counts('second'));
    await after(20_000);
  };
  const branching = async ({ out, signal }) => {
    signal.addEventListener('abort', () => {
      void new Application('app', { plugins: [plugins.bracket()] })
        .action(holding)
        .run({ host: { argv } });
    });
    await out.print(counts('first'));
    await out.print('ready');
    await after(20_000);
  };
  await new Application('app', { plugins: [plugins.bracket()] })
    .action(branching)
    .run({ host: { argv } });
  process.stdout.write('resolved\n');
} else if (scenario === 'twice') {
  // One Application, run twice, so each run installs its own listeners and removes them.
  const app = application();
  const first = await app.run({ host: { argv } });
  process.stdout.write(`${counts('between')}\n`);
  const second = await app.run({ host: { argv } });
  process.stdout.write(`${counts('after')}\n`);
  process.stdout.write(`resolved:${first}:${second}\n`);
} else if (scenario === 'not-a-signal-host') {
  /**
   * The invalid signal is read from a host whose stderr is overridden, so the diagnostic's
   * destination proves whether core read the override before or after the signal check.
   */
  const captured = [];
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      captured.push(chunk.toString());
      callback();
    },
  });
  const code = await application().run({ host: { argv, stderr }, signal: 'not a signal' });
  process.stdout.write(`captured:${JSON.stringify(captured.join(''))}\n`);
  process.stdout.write(`resolved:${code}\n`);
} else {
  const code = await application().run(options());
  process.stdout.write(`${counts('after')}\n`);
  process.stdout.write(`resolved:${code}\n`);
}
