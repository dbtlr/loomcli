import { Writable } from 'node:stream';
import { setTimeout as after } from 'node:timers/promises';

import { Application, FatalError, override, plugin, processHandle } from '@loomcli/core';

import { callerReason, controller } from './caller.mjs';

/** How many listeners the process holds for SIGINT and SIGTERM, read where a test wants the count. */
function counts(label) {
  return `${label}:${process.listenerCount('SIGINT')}:${process.listenerCount('SIGTERM')}`;
}

/**
 * Watches every signal listener added while it is armed, whatever removed it afterward, so a run
 * reads the listeners it added where a count taken after the run could not tell.
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
  /** Cancels the run from inside the chain, then takes over or continues the chain. */
  cancelling: () =>
    plugin('@fixture/cancelling', { middleware: { activate: 'always', load: marking } }),
  /** A hook that fails, which only the graph build meets. */
  failing: () =>
    plugin('@fixture/failing', {
      onCommandAttach: () => {
        throw new Error('the hook broke');
      },
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
    }),
  /** Adds the synchronous abort listener the contract describes, at the moment of the signal. */
  watching: () =>
    plugin('@fixture/watching', {
      middleware: { activate: 'always', load: () => import('./modules/watching.mjs') },
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
  'build-fault': ['watching', 'failing'],
  'caller-abort': [],
  'caller-then-signal': ['watching'],
  'default-fault': ['watching'],
  'first-cause': ['watching'],
  'hostile-stderr': ['watching'],
  'pending-loader': ['pending'],
  'pre-aborted': ['reporting'],
  'result-unemitted': [],
  'slow-flush': ['watching'],
  twice: ['watching'],
  unwatched: [],
  watching: ['watching'],
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
  'result-unemitted',
  'wrapped',
]);

/** The view a cancelled run meets when the scenario asks for a broken one. */
const registered = {
  'broken-renderer': () => [
    override(FatalError, {
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

/** An action that never reads the signal, so only the budget or a second signal ends the process. */
async function ignoring({ out }) {
  await out.print(counts('during'));
  await out.print('ready');
  await after(20_000);
  await out.print('slept');
}

/**
 * A cooperative action of a Command that declares a result: it stops the run and returns without
 * emitting one, which is the sanctioned path and raises no missing-result fault.
 */
async function abandoning({ signal }) {
  controller.abort(callerReason);
  await cancelled(signal);
}

/**
 * An action that cancels the run, catches the rejection its own wait raises, and returns. The
 * run stays cancelled, because a catch decides a failure's outcome and not the cancellation.
 */
async function catching({ out, signal }) {
  controller.abort(callerReason);
  try {
    await after(20_000, undefined, { signal });
  } catch {
    await out.print('caught');
  }
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

/** An action that writes once it runs and then holds, so a run that never reaches it writes nothing. */
async function holding({ out }) {
  await out.print('second:action');
  await after(20_000);
}

/** Starts a second run, and writes the code it resolves. */
async function startSecond() {
  const code = await new Application('app')
    .action(holding)
    .run({ process: processHandle({ argv }) });
  process.stdout.write(`second:${code}\n`);
}

/** Resolves when the embedding host's own listener sees a signal core re-raised. */
let absorbed = () => undefined;
const embedded = new Promise((resolve) => {
  absorbed = resolve;
});

/**
 * The caller cancels first, so the shutdown the process signal starts finds the run cancelled. An
 * embedding host's own listener absorbs both the signal and core's re-raise after the shutdown, so
 * the process survives them and ends with the run's status.
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

const actions = {
  abandoning,
  absorbing,
  catching,
  finishing,
  flushing,
  ignoring,
  racing,
  refusing,
  waiting,
};

/** The shutdown budget one scenario declares: a slow flush outlasts the default. */
const shutdowns = { 'slow-flush': { timeout: 4000 } };

function application() {
  const declared = new Application('app', {
    plugins: (installed[scenario] ?? []).map((name) => plugins[name]()),
    shutdown: shutdowns[scenario],
    views: (registered[scenario] ?? (() => []))(),
  });
  // A declared default its schema rejects is the one build rule that runs after the graph is built.
  const withDefault =
    scenario === 'default-fault'
      ? declared.option('level', { default: 'loud', type: 'string', validate: rejecting })
      : declared;
  // The one scenario that declares a result emits none, so the cancelled run answers for it.
  const declaring =
    scenario === 'result-unemitted'
      ? withDefault.result({ views: { text: { render: () => 'emitted\n' } } })
      : withDefault;
  return declaring.action(actions[process.env.LOOM_FIXTURE_ACTION ?? 'waiting']);
}

/** The release facts every run reads: a distributed build's. */
const release = { build: 'distributed' };

/** The host one scenario runs under, which is where a refusing or a slow destination enters. */
function hostOf() {
  if (scenario === 'hostile-stderr') {
    return { argv, release, stderr: hostile() };
  }
  if (scenario === 'slow-flush') {
    return { argv, release, stdout: slow(800) };
  }
  return { argv, release };
}

/** The run options one scenario supplies, which is where a caller-owned signal enters. */
function options() {
  const host = processHandle(hostOf());
  return callerSignal.has(scenario)
    ? { process: host, signal: controller.signal }
    : { process: host };
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
   * A synchronous listener on run A's abort starts run B during the shutdown, so B starts
   * cancelled, reaches no action, and does not extend the budget A's ignoring action runs out.
   */
  const branching = async ({ out, signal }) => {
    signal.addEventListener('abort', () => {
      void startSecond();
    });
    await out.print(counts('first'));
    await out.print('ready');
    await after(20_000);
  };
  await new Application('app').action(branching).run({ process: processHandle({ argv }) });
  process.stdout.write('resolved\n');
} else if (scenario === 'twice') {
  // One Application, run twice, so each run installs its own listeners and removes them.
  const app = application();
  const first = await app.run({ process: processHandle({ argv }) });
  process.stdout.write(`${counts('between')}\n`);
  const second = await app.run({ process: processHandle({ argv }) });
  process.stdout.write(`${counts('after')}\n`);
  process.stdout.write(`resolved:${first}:${second}\n`);
} else {
  const code = await application().run(options());
  process.stdout.write(`${counts('after')}\n`);
  process.stdout.write(`resolved:${code}\n`);
}
