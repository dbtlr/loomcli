import { Readable, Writable } from 'node:stream';

import { Application } from '@loomcli/core';

import { confirm, secret, select, text } from '../../dist/index.js';
import { questionFrame } from '../../dist/views.js';

/**
 * Questions asked on a recorded terminal. argv[2] names the scenario and argv[3] the keys pressed
 * last. Every write to stderr, and every resize, is recorded in order as an event a headless
 * terminal emulator replays, and `mark` records a named point in that order. The fixture prints
 * { answers, code, events, notes }.
 */
const [scenario, ending = 'enter'] = process.argv.slice(2);

const events = [];
const notes = {};
let answers = [];
let columns = 40;

/** Records a named point in the event order. */
function mark(name) {
  events.push({ mark: name });
}

/** Resizes the terminal between writes, as an operator does. */
function resize(width) {
  columns = width;
  events.push({ resize: width });
}

class Keyboard extends Readable {
  _read() {}
  setRawMode() {
    return this;
  }
}
const keyboard = new Keyboard();
const keys = { 'ctrl-c': '\u0003', enter: '\r', key: 'x' };

/**
 * The context's out with each region's draws observed: `onFrame` runs after each question frame
 * reaches the terminal, with the number of frames drawn so far.
 */
function observed(out, onFrame) {
  let frames = 0;
  return {
    ...out,
    region: (options) => {
      const region = out.region(options);
      notes.regions = [...(notes.regions ?? []), options];
      return {
        get closedBy() {
          return region.closedBy;
        },
        draw: async (data, view) => {
          await region.draw(data, view);
          if (view === questionFrame) {
            frames += 1;
            await onFrame(frames);
          }
        },
        end: (state) => region.end(state),
        live: region.live,
        report: (progress) => region.report(progress),
        signal: region.signal,
      };
    },
  };
}

/**
 * A text question whose frame starts at `start` columns, then the terminal resizes to `width`, a
 * key is pressed and its frame drawn, and then the ending keys are pressed.
 */
function edge(message, start, width) {
  return async (context) => {
    resize(start);
    await context.out.info('earlier output');
    const out = observed(context.out, async (frames) => {
      if (frames === 1) {
        mark('first');
        if (width !== start) {
          resize(width);
        }
        keyboard.push(keys.key);
      } else if (frames === 2) {
        mark('key');
        keyboard.push(keys[ending]);
      }
    });
    answers = [await text({ ...context, out }, { message })];
  };
}

const scenarios = {
  /** Each kind asked once, with every out.draw call and every region it opens recorded. */
  kinds: async (context) => {
    const drawn = [];
    const out = {
      ...observed(context.out, () => {
        keyboard.push('\r');
      }),
      draw: (data, view) => {
        drawn.push(view === questionFrame ? 'questionFrame' : JSON.stringify(data));
        return context.out.draw(data, view);
      },
    };
    const asked = { ...context, out };
    answers = [
      await text(asked, { default: 'a', message: 'Text' }),
      await secret(asked, { message: 'Secret', validate: undefined }),
      await confirm(asked, { default: true, message: 'Confirm' }),
      await select(asked, { choices: ['one', 'two'], message: 'Select' }),
    ];
    notes.drawn = [...new Set(drawn)];
  },
  /** A lane message a timer writes while a question asks. */
  timer: async (context) => {
    const out = observed(context.out, (frames) => {
      if (frames === 1) {
        setTimeout(async () => {
          await context.out.info('from a timer');
          mark('timer');
          keyboard.push('8080\r');
        }, 5);
      }
    });
    answers = [await text({ ...context, out }, { message: 'Port' })];
  },
  /** Two questions started at once, with the keys for both typed in one chunk. */
  together: async (context) => {
    const out = observed(context.out, (frames) => {
      if (frames === 1) {
        keyboard.push('one\rtwo\r');
      }
    });
    const asked = { ...context, out };
    answers = await Promise.all([
      text(asked, { message: 'First' }),
      text(asked, { message: 'Second' }),
    ]);
  },

  // The edge cases: `? `, ` › `, and the cursor cell add 6 columns to the message.
  /** A frame exactly as wide as the terminal, which the key makes wrap. */
  full: edge('f'.repeat(34), 40, 40),
  /** A one-row frame the terminal narrows until it wraps onto a second row. */
  narrow: edge('n'.repeat(30), 40, 20),
  /** A wide glyph that does not fit the last cell of the first row. */
  wide: edge(`${'g'.repeat(37)}界`, 40, 40),
  /** A two-row frame the terminal widens until it fits on one row. */
  widen: edge('w'.repeat(30), 20, 40),
};

const stderr = new Writable({
  write(chunk, _encoding, done) {
    events.push({ write: chunk.toString() });
    done();
  },
});
const app = new Application('live', { description: 'Ask on a recorded terminal.' }).action(
  scenarios[scenario],
);
const code = await app.run({
  host: {
    argv: [],
    env: {},
    stderr,
    stdin: keyboard,
    terminal: {
      stderr: {
        get columns() {
          return columns;
        },
        isTTY: true,
        rows: 24,
      },
      stdin: { isTTY: true },
      stdout: { columns: undefined, isTTY: false, rows: undefined },
    },
  },
});
process.stdout.write(JSON.stringify({ answers, code, events, notes }));
