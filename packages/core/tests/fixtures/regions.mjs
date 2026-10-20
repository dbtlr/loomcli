import { Writable } from 'node:stream';

import { Application, Command, extension, FatalError, plugin } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';

/**
 * One run of an application that opens live regions. argv[2] names the scenario, and argv[3] the
 * terminal: `tty` (the default) for a stderr that reports a terminal of 40 columns, `both` for a
 * stdout that is the same terminal, `pipe` for a stderr that is not a terminal, `invoke` for an
 * invocation by name, or `nested` for an action at a terminal that invokes the scenario by name. Every write that reaches the terminal, and every resize, is recorded in order
 * as an event a headless terminal emulator replays; `mark` records a named point in that order.
 * The rest of argv is the command line. The fixture prints { code, events, notes, stdout, messages }.
 */
const [scenario, terminal = 'tty', ...argv] = process.argv.slice(2);

const events = [];
const notes = {};
let columns = 40;
let stdoutText = '';

/** A bare view that writes its data as it is. */
const text = { render: (value) => value };

/** Records a named point in the event order, once every write before it has completed. */
function mark(name) {
  events.push({ mark: name });
}

/** Resizes the terminal between writes, as an operator does. */
function resize(width) {
  columns = width;
  events.push({ resize: width });
}

/** A stream whose writes reach the recorded terminal. */
function screenStream() {
  return new Writable({
    write(chunk, _encoding, done) {
      events.push({ write: chunk.toString() });
      done();
    },
  });
}

/** A stream that captures what a pipe would hold. */
const piped = new Writable({
  write(chunk, _encoding, done) {
    stdoutText += chunk.toString();
    done();
  },
});

/** The closer each named region read when its signal aborted. */
function watch(name, region, onAbort) {
  region.signal.addEventListener(
    'abort',
    () => {
      notes[name] = region.closedBy;
      onAbort?.(region);
    },
    { once: true },
  );
  return region;
}

/** A schema that accepts any value. */
const accepting = {
  '~standard': { validate: (value) => ({ value }), vendor: 'fixture', version: 1 },
};

/** The binding the fixture source answers for. */
const tag = extension('@fixture/source/tag', { schema: accepting, target: 'option' });

/** A plugin whose middleware runs `body` around the rest of the chain. */
function around(body) {
  return plugin('@fixture/around', {
    middleware: { activate: 'always', load: async () => ({ default: body }) },
  });
}

const caller = new AbortController();

/** Two rows with a pause between them, so the sequence is still open when later calls are issued. */
async function* streamed() {
  yield 'row one';
  await new Promise((resolve) => {
    setTimeout(resolve, 5);
  });
  yield 'row two';
}

/** Two rows with an info line the source awaits between them. */
async function* reporting(out) {
  yield 'row one';
  await out.info('fetching page two');
  yield 'row two';
}

/** A row sequence whose source reports between rows, and a print issued behind it, both unawaited. */
async function reported(out) {
  const rows = out.render(reporting(out), { row: (row) => `${row}\n` });
  const after = out.print('after rows');
  await Promise.all([rows, after]);
  mark('written');
}

/** A plugin whose onLog hook writes each record to its destination's stderr. */
const hook = plugin('@fixture/hook', {
  onLog: (event, destination) => {
    destination.stderr?.write(`hook ${event.message}\n`);
  },
});

/** Each scenario: the plugins it installs, and its action. */
const scenarios = {
  /** Three records logged at once, then a lane line, while a region is drawn. */
  burst: {
    action: async ({ log, out }) => {
      const region = out.region();
      await region.draw('frame', text);
      log.info('one');
      log.info('two');
      log.info('three');
      await out.info('lane');
      // The fixture waits for any record the stream still holds to reach the terminal.
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      mark('logged');
    },
    plugins: [hook],
  },
  /** The run's cancellation with an open region and a second input region still waiting. */
  cancel: {
    action: async ({ out }) => {
      watch('cancellation', out.region(), (region) => {
        void region.draw('cancelled frame', text);
      });
      await out.region({ input: true }).draw('question', text);
      watch('waiting', out.region({ input: true }));
      caller.abort();
    },
  },
  /** Closing the top region, then a region whose last frame is empty. */
  close: {
    action: async ({ out }) => {
      const first = out.region();
      const second = out.region();
      const third = out.region();
      await first.draw('first frame', text);
      await second.draw('second frame', text);
      await third.draw('third frame', text);
      await first.end();
      mark('top closed');
      await third.draw('', text);
      await third.end();
      mark('empty closed');
    },
  },
  /** Calls on a region that has closed. */
  closed: {
    action: async ({ out }) => {
      const region = out.region();
      await region.draw('frame', text);
      await region.end();
      const views = { calls: 0 };
      await region.draw('late', {
        render: (value) => {
          views.calls += 1;
          return value;
        },
      });
      await region.end('failed');
      region.report({ completed: 1 });
      notes.closedBy = region.closedBy;
      notes.calls = views.calls;
      mark('after');
    },
  },
  /** Out.draw's count, beside an open region and under -q. */
  draw: {
    action: async ({ out }) => {
      const region = out.region();
      await region.draw('frame', text);
      notes.count = await out.draw('drawn\nrow', text);
      mark('drawn');
    },
    verbose: true,
  },
  /** A failure with a region open in the action, a middleware, and a configuration source. */
  failure: {
    action: async ({ out }) => {
      watch('failure', out.region(), (region) => {
        void region.draw('action failed frame', text);
      });
      await out.region().draw('action frame', text);
      throw new FatalError('It failed.');
    },
    plugins: [
      around(async ({ next, out }) => {
        const region = watch('middleware', out.region(), (closing) => {
          void closing.draw('middleware failed frame', text);
        });
        await region.draw('middleware frame', text);
        await next();
      }),
      plugin('@fixture/source', {
        extensions: [tag],
        source: {
          binding: tag,
          load: async () => ({
            default: async ({ out }) => {
              const region = watch('source', out.region(), (closing) => {
                void closing.draw('source failed frame', text);
              });
              await region.draw('source frame', text);
              return {};
            },
          }),
        },
      }),
    ],
    tagged: true,
  },
  /** One malformed call, named by argv[4]. */
  fault: {
    action: async ({ out }) => {
      const call = argv[0];
      const region = out.region();
      const calls = {
        closedLabel: async () => {
          await region.end();
          region.report({ label: 3 });
        },
        closedState: async () => {
          await region.end();
          await region.end('done');
        },
        completed: () => region.report({ completed: -1 }),
        endLabel: () => region.end('ended', 3),
        input: () => out.region({ input: 'yes' }),
        label: () => region.report({ label: 3 }),
        options: () => out.region([]),
        report: () => region.report('three'),
        state: () => region.end('done'),
        total: () => region.report({ total: Number.POSITIVE_INFINITY }),
      };
      try {
        await calls[call]();
      } catch (error) {
        notes.name = error.name;
        notes.rule = error.rule?.identity;
        notes.message = `${error.sentence} ${error.correction}`;
      }
    },
  },
  /** An out.draw that fills the 40-column row exactly, then an info line, above an open region. */
  fullInfo: {
    action: async ({ out }) => {
      await out.region().draw('frame', text);
      await out.draw('x'.repeat(40), text);
      await out.info('done');
      mark('written');
    },
  },
  /** An onLog hook that writes to its destination's stderr while a region is drawn. */
  hook: {
    action: async ({ log, out }) => {
      const region = out.region();
      await region.draw('frame', text);
      log.info('heard');
      await region.draw('frame again', text);
      mark('logged');
    },
    plugins: [hook],
  },
  /** A region redrawn while an input region is open, and one that closes meanwhile. */
  input: {
    action: async ({ out }) => {
      const ticking = out.region();
      const closing = out.region();
      await ticking.draw('tick 0', text);
      await closing.draw('closing frame', text);
      const question = out.region({ input: true });
      await question.draw('question', text);
      await ticking.draw('tick 1', text);
      await ticking.draw('tick 2', text);
      await closing.draw('closing last', text);
      await closing.end();
      mark('frozen');
      const second = out.region({ input: true });
      let opened = false;
      const waiting = (async () => {
        await second.draw('second question', text);
        opened = true;
      })();
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      notes.openedBeforeClose = opened;
      await question.draw('answered', text);
      await question.end();
      await waiting;
      notes.openedAfterClose = opened;
      mark('released');
      await second.end();
    },
  },
  /** A region opened after the run's signal has aborted. */
  late: {
    action: async ({ out }) => {
      caller.abort();
      notes.late = out.region().closedBy;
    },
  },
  /** Whether a region is live, and whether its draw reached its view. */
  live: {
    action: async ({ out }) => {
      const plain = out.region();
      const input = out.region({ input: true });
      notes.calls = 0;
      const counted = {
        render: (value) => {
          notes.calls += 1;
          return value;
        },
      };
      notes.live = plain.live;
      notes.inputLive = input.live;
      await plain.draw('plain frame', counted);
      await input.draw('input frame', counted);
      await input.end();
    },
    verbose: true,
  },
  /** Regions a middleware opens around the action, and the action's own. */
  middleware: {
    action: async ({ out }) => {
      watch('action', out.region());
    },
    plugins: [
      around(async ({ next, out }) => {
        const before = watch('before', out.region());
        await next();
        notes.beforeAfterNext = before.closedBy ?? 'open';
        notes.actionAfterNext = notes.action ?? 'open';
        watch('after', out.region());
      }),
    ],
  },
  /** Unawaited print, info, and print calls while a region is drawn. */
  ordered: {
    action: async ({ out }) => {
      const region = out.region();
      await region.draw('frame', text);
      await Promise.all([out.print('first'), out.info('second'), out.print('third')]);
      mark('written');
    },
  },
  /** An unawaited row sequence on stdout, a print and an info line after it, while a region is drawn. */
  orderedRows: {
    action: async ({ out }) => {
      const region = out.region();
      await region.draw('frame', text);
      await Promise.all([
        out.render(streamed(), { row: (row) => `${row}\n` }),
        out.print('after rows'),
        out.info('noted'),
      ]);
      mark('written');
    },
  },
  /** A partial line drawn before the first region draws. */
  partial: {
    action: async ({ out }) => {
      await out.draw('partial', text);
      await out.region().draw('frame', text);
      mark('drawn');
    },
  },
  /** A partial out.draw, then an info line, above an open region. */
  partialInfo: {
    action: async ({ out }) => {
      await out.region().draw('frame', text);
      await out.draw('partial', text);
      await out.info('done');
      mark('written');
    },
  },
  /** A partial line rendered to stdout before the first region draws, and a redraw. */
  partialStdout: {
    action: async ({ out }) => {
      await out.render('partial', text);
      const region = out.region();
      await region.draw('frame one', text);
      await region.draw('frame two', text);
      mark('drawn');
    },
  },
  /** A partial line drawn on stderr, a whole line printed to stdout, then the first region. */
  printedAfterPartial: {
    action: async ({ out }) => {
      await out.draw('partial', text);
      await out.print('printed');
      await out.region().draw('frame', text);
      mark('drawn');
    },
  },
  /** A two-row out.draw frame redrawn by its count three times above an open region. */
  redraw: {
    action: async ({ out }) => {
      await out.region().draw('progress line', text);
      let rows = 0;
      for (const step of [1, 2, 3]) {
        if (step > 1) {
          await out.draw(`\r\u001b[${String(rows)}A\u001b[J`, text);
        }
        rows = await out.draw(`frame ${String(step)} top\nframe ${String(step)} bottom`, text);
      }
      mark('redrawn');
    },
  },
  /** A row source that awaits an info line between rows, with a print issued behind its sequence. */
  reported: {
    action: async ({ out }) => {
      await reported(out);
    },
  },
  /** The reported scenario while a region is drawn. */
  reportedRegion: {
    action: async ({ out }) => {
      await out.region().draw('frame', text);
      await reported(out);
    },
  },
  /** A two-row frame drawn at 80 columns, the terminal narrowed to 40, and a redraw. */
  resize: {
    action: async ({ out }) => {
      resize(80);
      const region = out.region();
      await region.draw(`${'a'.repeat(60)}\n${'b'.repeat(60)}`, text);
      resize(40);
      await region.draw('after', text);
      mark('redrawn');
    },
  },
  /** Each way a region closes, and a frame its abort listener draws. */
  signals: {
    action: async ({ out }) => {
      const ended = watch('end', out.region());
      await ended.draw('ending', text);
      await ended.end();
      watch('completion', out.region(), (region) => {
        void region.draw('completed by core', text);
      }).draw('running', text);
    },
  },
  /** Two regions, a lane line and a debug line between their frames, and a frame that grows. */
  stack: {
    action: async ({ out }) => {
      const first = out.region();
      const second = out.region();
      await first.draw('first frame', text);
      await second.draw('second frame', text);
      await out.info('info line');
      await out.debug('debug line');
      mark('lines');
      await first.draw('first frame\nfirst grown row', text);
      mark('grown');
    },
  },
  /** A line printed to stdout while a region is drawn. */
  stdout: {
    action: async ({ out }) => {
      const region = out.region();
      await region.draw('frame', text);
      await out.print('printed');
      await region.draw('frame again', text);
      mark('printed');
    },
  },
  /** A region a configuration source opens, under a run that --help takes over. */
  takeover: {
    action: async () => undefined,
    plugins: [
      help(),
      plugin('@fixture/source', {
        extensions: [tag],
        source: {
          binding: tag,
          load: async () => ({
            default: async ({ out }) => {
              watch('source', out.region());
              return {};
            },
          }),
        },
      }),
    ],
    tagged: true,
  },
};

const chosen = scenarios[scenario];
let app = new Application('regions', {
  description: 'Draw live regions.',
  plugins: chosen.plugins ?? [],
}).globalOption('verbose', {
  description: 'Show more detail.',
  short: 'v',
  type: 'count',
  verbose: true,
});
app = app.globalOption('quiet', {
  description: 'Show less.',
  quiet: true,
  short: 'q',
  type: 'count',
});
if (chosen.tagged) {
  app = app.globalOption('tint', {
    description: 'The tint.',
    extensions: [tag(true)],
    type: 'string',
  });
}
// Under `nested`, the scenario runs as a Command the action invokes by name, at a terminal.
app =
  terminal === 'nested'
    ? app
        .command(new Command('inner', { description: 'Run the scenario.' }).action(chosen.action))
        .action(async ({ invoke }) => {
          await invoke(['inner'], {});
        })
    : app.action(chosen.action);

const stderr = screenStream();
const stdout = terminal === 'both' ? screenStream() : piped;
const tty = terminal === 'tty' || terminal === 'both' || terminal === 'nested';
let code = 0;
let messages = undefined;
if (terminal === 'invoke') {
  const outcome = await app.invoke([], {});
  code = outcome.status;
  messages = outcome.messages;
} else {
  code = await app.run({
    host: {
      argv: scenario === 'fault' ? [] : argv,
      env: {},
      stderr,
      stdout,
      terminal: {
        stderr: {
          get columns() {
            return tty ? columns : undefined;
          },
          isTTY: tty,
          rows: 24,
        },
        stdin: { isTTY: false },
        stdout: {
          columns: terminal === 'both' ? columns : undefined,
          isTTY: terminal === 'both',
          rows: 24,
        },
      },
    },
    signal: caller.signal,
  });
}
process.stdout.write(JSON.stringify({ code, events, messages, notes, stdout: stdoutText }));
