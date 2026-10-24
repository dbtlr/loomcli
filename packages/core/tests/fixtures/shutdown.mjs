import { writeSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Application, onResume, onShutdown, onSuspend, plugin, processHandle } from '@loomcli/core';

/**
 * The shutdown on a real process, one scenario per run: `process.argv[2]` names it. Every line is
 * a synchronous write, because a line written just before a signal ends the process must not wait
 * in a stream's buffer.
 */
function line(text) {
  writeSync(1, `${text}\n`);
}

/** Holds the process open until a signal ends it, because a signal listener alone does not. */
function holdOpen() {
  return new Promise(() => {
    setInterval(() => undefined, 60_000);
  });
}

/** Resolves once the run is cancelled, holding one referenced timer until then. */
function cancelled(signal) {
  return new Promise((resolve) => {
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

/** How many listeners the process holds for each ending signal and for its own end, in order. */
function ending() {
  return ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'exit']
    .map((name) => process.listenerCount(name))
    .join(',');
}

/** How many listeners the process holds for suspend and resume. */
function suspending() {
  return ['SIGTSTP', 'SIGCONT'].map((name) => process.listenerCount(name)).join(',');
}

/** A shutdown handler that writes what ended the process, under one label. */
function writing(label) {
  return (event) => {
    line(`${label}:${event.cause}:${event.code}`);
  };
}

/** The budget the scenario's Application declares, from `LOOM_FIXTURE_TIMEOUT`, or the default. */
const shutdown =
  process.env.LOOM_FIXTURE_TIMEOUT === undefined
    ? undefined
    : { timeout: Number(process.env.LOOM_FIXTURE_TIMEOUT) };

/** A plugin whose middleware registers a shutdown handler before the chain continues. */
const registering = plugin('@fixture/registering', {
  middleware: {
    activate: 'always',
    load: () => ({
      default: async ({ next, onShutdown: register }) => {
        register(writing('middleware'));
        await next();
      },
    }),
  },
});

const scenarios = {
  /** A cooperative action: it waits for its cancellation and returns. */
  cooperative: () =>
    new Application('app', { shutdown }).action(async ({ signal }) => {
      line(`ready:${process.pid}:`);
      await cancelled(signal);
      line(`action:${signal.reason.source}`);
    }),
  /** `process.exit()` mid-action: the pending handler runs with `exit` and the status. */
  exit: () =>
    new Application('app').action(({ onShutdown: register }) => {
      register(writing('handler'));
      process.exit(3);
    }),
  /** An action that ignores its signal: only the budget ends the process. */
  ignoring: () =>
    new Application('app', { shutdown }).action(async ({ onShutdown: register }) => {
      register(writing('handler'));
      line(`ready:${process.pid}:`);
      await holdOpen();
    }),
  /** A run that asks nothing: core listens while it is live and holds nothing before or after. */
  listening: () =>
    new Application('app').action(() => {
      line(`during:${ending()}`);
    }),
  /** Handlers from the middleware, the action, and the process, called newest first. */
  order: () =>
    new Application('app', { plugins: [registering], shutdown }).action(
      async ({ onShutdown: register, signal }) => {
        register(writing('first'));
        register(writing('second'));
        line(`ready:${process.pid}:`);
        await cancelled(signal);
        line(`unwound:${signal.reason.source}`);
      },
    ),
  /**
   * An action that changes the terminal the way a question does: raw mode and a hidden cursor,
   * restored through `onShutdown`, synchronously, and then ignores its signal.
   */
  'raw-terminal': () =>
    new Application('app').action(async ({ onShutdown: register }) => {
      process.stdin.setRawMode(true);
      writeSync(1, '\u001B[?25l');
      register(() => {
        process.stdin.setRawMode(false);
        writeSync(1, '\u001B[?25h');
      });
      line(`ready:${process.pid}:`);
      await holdOpen();
    }),
  /** A live region whose abort listener draws its cancelled line, at a budget of 0. */
  region: () =>
    new Application('app', { shutdown: { timeout: 0 } }).action(async ({ out }) => {
      const view = { render: (text) => text };
      const region = out.region();
      region.signal.addEventListener('abort', () => {
        void region.draw('CANCELLED-LINE', view);
      });
      await region.draw('WORKING-FRAME', view);
      line(`ready:${process.pid}:`);
      await holdOpen();
    }),
  /**
   * `signal-exit` installed beside core, as execa and ora install it, with an action that ignores
   * its signal or one that honours it.
   */
  'signal-exit': async () => {
    const { onExit } = await import('signal-exit');
    return new Application('app', { shutdown }).action(async ({ onShutdown: register, signal }) => {
      onExit((code, received) => {
        line(`signal-exit:${String(code)}:${String(received)}`);
      });
      register(writing('handler'));
      line(`ready:${process.pid}:`);
      if (process.env.LOOM_FIXTURE_HONOURS === 'yes') {
        await cancelled(signal);
        line(`action:${signal.reason.source}`);
      } else {
        await holdOpen();
      }
    });
  },
};

const scenario = process.argv[2];

if (scenario === 'two-copies') {
  // A second installed copy of core: its own module instance, loaded from another folder.
  const copy = await import(pathToFileURL(join(process.env.LOOM_CORE_COPY ?? '', 'index.js')).href);
  onShutdown(writing('original'));
  await new copy.Application('app')
    .action(async ({ onShutdown: register }) => {
      register(writing('copy'));
      line(`ready:${ending()}`);
      await holdOpen();
    })
    .run({ process: copy.processHandle({ argv: [] }) });
} else if (scenario === 'process-scoped') {
  // A handler from the exported onShutdown keeps core listening with no run at all.
  line(`before:${ending()}`);
  const remove = onShutdown(writing('removed'));
  onShutdown(writing('kept'));
  remove();
  line(`ready:${ending()}`);
  await holdOpen();
} else if (scenario === 'uncaught') {
  /**
   * An uncaught exception mid-action ends the process, and the pending handler runs at its end. The
   * run is not awaited at the top level, because Bun keeps a process alive after an uncaught
   * exception while a top-level await is pending.
   */
  line(`before:${ending()}`);
  void new Application('app')
    .action(async ({ onShutdown: register }) => {
      register(writing('handler'));
      setTimeout(() => {
        throw new Error('the timer broke');
      }, 0);
      await holdOpen();
    })
    .run({ process: processHandle({ argv: [] }) });
} else if (scenario === 'suspend') {
  line(`before:${suspending()}`);
  for (const label of ['first', 'second']) {
    onSuspend(() => {
      line(`suspended:${label}`);
    });
    onResume(() => {
      line(`resumed:${label}`);
    });
  }
  // A listener outside core, added after core's, writes once core has handled each `SIGCONT`.
  process.on('SIGCONT', () => {
    line('continued');
  });
  line(`ready:${suspending()}:${ending()}`);
  await holdOpen();
} else {
  line(`before:${ending()}`);
  const app = await scenarios[scenario]();
  const code = await app.run({ process: processHandle({ argv: [] }) });
  line(`resolved:${code}:${ending()}`);
}
