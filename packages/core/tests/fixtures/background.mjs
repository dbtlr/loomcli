import { Readable, Writable } from 'node:stream';

import { Application, LoomError, override, plugin, style } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import { theme } from '@loomcli/plugins/theme';

/**
 * One run of an application on a scripted fake terminal. argv[2] holds the scenario as JSON:
 * `argv`, `env`, `platform`, the `rendering` policy of `run()` and `declared`, the Application's,
 * the `terminal` kinds, a `stated` background, `reader`, which theme, plugins, and own marked
 * option the Application installs, the scripted `replies` and the `delay` before the terminal sends them, `before`,
 * typeahead already waiting on stdin, `raw`, whether stdin offers raw mode, `startRaw`, `abort`,
 * a delay after which the caller aborts the run, `wait`, how long the action waits before it
 * reads stdin, `listen`, whether the action reads stdin through a bare data listener instead of
 * `read()`, `prepare`, variables an onEnvironment hook imports, `fail`, whether the action
 * fails, `invoke`, whether the run is an invocation by name, and `kill: 'record'`, which records the
 * signals core raises on the process instead of sending them. It prints what happened as JSON.
 */
const scenario = JSON.parse(process.argv[2]);

const deadlineTimers = [];
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (callback, delay, ...rest) => {
  const timer = realSetTimeout(callback, delay, ...rest);
  if (delay === 1000) {
    deadlineTimers.push({ clearedAfter: undefined, created: performance.now(), timer });
  }
  return timer;
};
globalThis.clearTimeout = (timer) => {
  const record = deadlineTimers.find((entry) => entry.timer === timer);
  if (record !== undefined && record.clearedAfter === undefined) {
    record.clearedAfter = performance.now() - record.created;
  }
  return realClearTimeout(timer);
};

/** Text the scenario spells with `<ESC>` and `<BEL>` in place of the two control characters. */
function decoded(text) {
  return (text ?? '')
    .replaceAll('<ESC>', String.fromCodePoint(27))
    .replaceAll('<BEL>', String.fromCodePoint(7));
}

/** Text with its two control characters spelled back, so the report reads as plain JSON text. */
function encoded(text) {
  return text
    .replaceAll(String.fromCodePoint(27), '<ESC>')
    .replaceAll(String.fromCodePoint(7), '<BEL>');
}

/** A fake terminal stdin: a stream the script pushes into, with a raw mode it records. */
class ScriptedInput extends Readable {
  isTTY = true;
  isRaw = scenario.startRaw === true;
  modes = [];

  _read() {}

  setRawMode(mode) {
    this.isRaw = mode;
    this.modes.push(mode);
    return this;
  }
}
const stdin = new ScriptedInput();
if (scenario.raw === false) {
  // A stream that offers no raw mode.
  stdin.setRawMode = undefined;
}
if (scenario.raw === 'throws') {
  // A stream whose raw mode the terminal refuses.
  stdin.setRawMode = () => {
    throw new Error('EIO');
  };
}
if (scenario.before !== undefined) {
  stdin.push(decoded(scenario.before));
}

/** Each signal core raised on a process under `kill: 'record'`, which records instead of sending. */
const raised = [];
if (scenario.kill === 'record') {
  process.kill = (pid, signal) => {
    raised.push({ raw: stdin.isRaw, self: pid === process.pid, signal });
    return true;
  };
}

const query = decoded(String.raw`<ESC>]11;?<ESC>\<ESC>[?996n<ESC>[c`);
let queried = 0;

/** A fake terminal output stream that records its bytes, and answers the query as scripted. */
function output() {
  const written = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const text = String(chunk);
      written.push(text);
      if (text.includes(query)) {
        queried += 1;
        if (scenario.replies !== undefined) {
          realSetTimeout(() => stdin.push(decoded(scenario.replies)), scenario.delay ?? 5);
        }
      }
      callback();
    },
  });
  return { stream, text: () => encoded(written.join('')) };
}
const stdout = output();
const stderr = output();

const kinds = scenario.terminal ?? {};
const terminal = {
  stderr: { columns: 80, isTTY: kinds.stderr ?? true, rows: 24 },
  stdin: { isTTY: kinds.stdin ?? true },
  stdout: { columns: 80, isTTY: kinds.stdout ?? true, rows: 24 },
  ...(scenario.stated === undefined ? {} : { background: scenario.stated }),
};

/** An adaptive token whose sides print apart, and a plain one. */
const sides = {
  dark: style.hex('#102030', { ansi16: 'blue', ansi256: 17 }),
  light: style.hex('#F0E0D0', { ansi16: 'yellow', ansi256: 223 }),
};
const accent = style.adaptive(sides);
// The adaptive style keeps its own copy, so a change to the object it was given changes no byte.
sides.light = style.red;
const reader = scenario.reader ?? 'adaptive';
const plugins = [
  theme(
    reader === 'plain' || reader === 'mark' ? { plain: style.cyan } : { accent, plain: style.cyan },
  ),
  ...(reader === 'mark' || reader === 'both' ? [background()] : []),
];
if (scenario.prepare !== undefined) {
  plugins.push(plugin('@fixture/prepare', { onEnvironment: () => scenario.prepare }));
}

/** What the run's readers saw: the action, a middleware, and a view. */
const seen = { action: 'unread', middleware: 'unread', view: 'unread' };
plugins.push(
  plugin('@fixture/observe', {
    middleware: {
      activate: 'always',
      load: () => ({
        default: async ({ host, next }) => {
          seen.middleware = host.terminal.background ?? null;
          await next();
        },
      }),
    },
  }),
);

/** The failure view override, which records the background a failure view reads. */
const failureLine = {
  render: (failure, context) => {
    seen.failure = context.background ?? null;
    return failure.message;
  },
};

let stdinRead = undefined;
const declared = new Application('notes', {
  plugins,
  rendering: scenario.declared,
  views: [override(LoomError, failureLine)],
});
// The `own` reader marks the application's own option, spelled --shade or by its alias --tint.
const app = (
  reader === 'own'
    ? declared.globalOption('shade', { aliases: ['tint'], background: true, type: 'string' })
    : declared
).action(async ({ host, out, style: contextual, options }) => {
  seen.action = host.terminal.background ?? null;
  seen.option = options.background ?? options.shade ?? null;
  await out.render('', {
    render: (_data, context) => {
      seen.view = context.background ?? null;
      return '';
    },
  });
  await out.print(
    reader === 'plain' || reader === 'mark'
      ? contextual.plain('plain')
      : `${contextual.accent('accent')} ${contextual.plain('plain')}`,
  );
  if (scenario.wait !== undefined) {
    await new Promise((resolve) => realSetTimeout(resolve, scenario.wait));
  }
  if (scenario.listen) {
    // A bare data listener that never calls resume(), then a key typed after the listener attaches.
    const chunks = [];
    const collect = (chunk) => chunks.push(String(chunk));
    host.stdin.on('data', collect);
    realSetTimeout(() => stdin.push('z'), 10);
    await new Promise((resolve) => realSetTimeout(resolve, 50));
    host.stdin.off('data', collect);
    host.stdin.pause();
    stdinRead = encoded(chunks.join(''));
  } else {
    const chunk = host.stdin.read();
    stdinRead = chunk === null ? null : encoded(String(chunk));
  }
  if (scenario.fail) {
    throw new LoomError('Failed.');
  }
});

const controller = new AbortController();
if (scenario.abort === 0) {
  controller.abort();
} else if (scenario.abort !== undefined) {
  realSetTimeout(() => controller.abort(), scenario.abort);
}

// A real terminal's stdin keeps the process alive while core waits; the scripted one holds nothing.
const keepAlive = setInterval(() => undefined, 60_000);
const started = performance.now();
let code = undefined;
if (scenario.invoke) {
  const outcome = await app.invoke(
    [],
    {},
    { host: { env: scenario.env ?? {}, release: { build: 'distributed' } } },
  );
  code = outcome.status === 'failed' ? outcome.messages : outcome.status;
} else {
  code = await app.run({
    host: {
      argv: scenario.argv ?? [],
      env: scenario.env ?? { COLORTERM: 'truecolor', TERM: 'xterm-256color' },
      platform: scenario.platform ?? 'linux',
      release: { build: 'distributed' },
      stderr: stderr.stream,
      stdin,
      stdout: stdout.stream,
      terminal,
    },
    rendering: scenario.rendering,
    signal: controller.signal,
  });
}
const elapsed = performance.now() - started;
clearInterval(keepAlive);
process.exitCode = 0;
process.stdout.write(
  JSON.stringify({
    code,
    deadline: deadlineTimers.map(({ clearedAfter, timer }) => ({
      cleared: clearedAfter !== undefined,
      clearedSoon: clearedAfter !== undefined && clearedAfter < 500,
      referenced: timer.hasRef(),
    })),
    elapsed: elapsed >= 1000 ? 'deadline' : 'prompt',
    flowing: stdin.readableFlowing,
    listeners: ['close', 'data', 'end', 'error', 'readable'].reduce(
      (count, event) => count + stdin.listenerCount(event),
      0,
    ),
    modes: stdin.modes,
    paused: stdin.isPaused(),
    queried,
    raised,
    raw: stdin.isRaw,
    seen,
    stderr: stderr.text(),
    stdinRead,
    stdout: stdout.text(),
  }),
);
