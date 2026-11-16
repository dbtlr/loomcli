import { StringDecoder } from 'node:string_decoder';

import { raiseInterruptKeys } from '@loomcli/core';
import type { Region, View } from '@loomcli/core';

import { controls } from './controls.js';
import { graphemes } from './line.js';
import type { PromptContext } from './types.js';
import { cancelledLine, questionLine } from './views.js';
import type { QuestionLine } from './views.js';

/** What one read of a line answers: the line Enter ended, or the end of input. */
type LineRead = { readonly kind: 'line'; readonly value: string } | { readonly kind: 'eof' };

/**
 * Where an escape sequence that starts at `start` ends: past a CSI or SS3 sequence, past the ESC
 * alone before any other character, or `undefined` while the read ends inside the sequence.
 */
function sequenceEnd(text: string, start: number): number | undefined {
  const intro = text[start + 1];
  if (intro === undefined) {
    return undefined;
  }
  if (intro === 'O') {
    return text[start + 2] === undefined ? undefined : start + 3;
  }
  if (intro !== '[') {
    return start + 1;
  }
  for (let index = start + 2; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index + 1;
    }
    if (code < 0x20 || code > 0x7e) {
      return index;
    }
  }
  return undefined;
}

/** The line with its last word removed, and the spaces after it, as Ctrl-W removes it. */
function withoutLastWord(line: string): string {
  return line.replace(/\S*\s*$/u, '');
}

/**
 * One run's hold on stdin for its questions asked line by line. It reads stdin one read at a time,
 * only while a question waits for a line, and never switches it to raw mode except while a secret
 * reads. Each read's text waits in the run's queue until a question takes a line from it, so a
 * line typed ahead answers the next question. The one line rule reads every read: a printable
 * character joins the line, Backspace removes its last grapheme, Enter, `\r`, `\n`, or `\r\n`,
 * ends it, Ctrl-D ends input on an empty line, and every other key, a sequence included, adds
 * nothing. A secret also clears the line at Ctrl-U and removes its last word at Ctrl-W, the keys a
 * terminal's line mode edits with, because it reads in raw mode, where the terminal edits nothing.
 * Ctrl-C, Ctrl-\, and Ctrl-Z, which arrive as bytes on a stdin that is not in its line mode, raise
 * their signals as the raw-mode reader's keys do.
 */
class LineInput {
  readonly #context: PromptContext<unknown>;
  #decoder = new StringDecoder('utf8');
  /** The text of each read no question has finished, oldest first. */
  #reads: string[] = [];
  /** Whether the first queued read is the rest of the read that held the last line's Enter. */
  #restOfLast = false;
  /** The line typed so far. */
  #partial = '';
  /** Whether the last character ended a line with `\r`, so a `\n` after it ends nothing. */
  #carriage = false;
  #wake: (() => void) | undefined = undefined;
  #failure: { error: unknown } | undefined = undefined;
  /** Whether Ctrl-C or Ctrl-\ raised its signal, after which every read is dropped. */
  #interrupted = false;
  #readers = 0;
  #raw = false;
  #removers: (() => void)[] = [];

  constructor(context: PromptContext<unknown>) {
    this.#context = context;
  }

  get #input() {
    return this.#context.host.stdin;
  }

  /** Begins one question's reading, holding stdin while it is the run's first. */
  open(): void {
    this.#readers += 1;
    if (this.#readers > 1) {
      return;
    }
    const input = this.#input;
    // Paused first, so the data listener reads nothing until a question waits for a line.
    input.pause();
    input.on('data', this.#data).once('end', this.#end).once('close', this.#end);
    input.on('error', this.#error);
    this.#removers = [
      this.#context.onResume(() => {
        if (this.#raw) {
          this.#rawMode(true);
        }
        if (this.#wake !== undefined) {
          input.resume();
        }
      }),
      this.#context.onSuspend(() => {
        if (this.#raw) {
          this.#rawMode(false);
        }
      }),
      this.#context.onShutdown(() => {
        if (this.#raw) {
          this.#rawMode(false);
        }
      }),
    ];
    if (input.readableEnded || input.destroyed) {
      this.#context.cancel();
    }
  }

  /** Ends one question's reading, letting stdin go once no question of the run reads it. */
  close(): void {
    this.#readers -= 1;
    if (this.#readers > 0) {
      return;
    }
    this.release();
  }

  /**
   * Lets stdin go now, as an editor question does while its editor reads the terminal: the
   * listeners leave and stdin pauses, and the queued text stays until `drop`. `open` holds it
   * again.
   */
  release(): void {
    this.#readers = 0;
    for (const remove of this.#removers.splice(0)) {
      remove();
    }
    const input = this.#input;
    input.off('data', this.#data).off('end', this.#end).off('close', this.#end);
    input.off('error', this.#error);
    input.pause();
    this.#wake = undefined;
  }

  /** Drops every read still queued and the line typed so far, as an editor's start does. */
  drop(): void {
    this.#reads = [];
    this.#restOfLast = false;
    this.#partial = '';
    this.#carriage = false;
    this.#decoder = new StringDecoder('utf8');
  }

  /** Clears the line typed so far, as a terminal in its line mode discards it at Ctrl-Z. */
  clearLine(): void {
    this.#partial = '';
  }

  /**
   * Holds stdin in raw mode while a secret reads, so nothing it types is echoed, or leaves raw
   * mode once the secret ends. A stdin with no `setRawMode` method cannot hide a secret.
   */
  raw(mode: boolean): void {
    if (mode && !('setRawMode' in this.#input && typeof this.#input.setRawMode === 'function')) {
      throw new TypeError('Interactive stdin has no setRawMode method.');
    }
    this.#raw = mode;
    this.#rawMode(mode);
  }

  #rawMode(mode: boolean): void {
    const input = this.#input;
    if ('setRawMode' in input && typeof input.setRawMode === 'function') {
      input.setRawMode(mode);
    }
  }

  /**
   * Drops the rest of the read that held the last line's Enter, as an accepted secret does, so
   * text typed after it never answers the next question.
   */
  discardRest(): void {
    if (this.#restOfLast) {
      this.#reads.shift();
      this.#restOfLast = false;
    }
  }

  /** Reads the next line, rejecting with `signal`'s reason once it aborts. */
  async line(options: {
    readonly secret: boolean;
    readonly signal: AbortSignal;
  }): Promise<LineRead> {
    while (true) {
      options.signal.throwIfAborted();
      if (this.#failure !== undefined) {
        throw this.#failure.error;
      }
      const read = this.#take(options.secret);
      if (read !== undefined) {
        return read;
      }
      await this.#more(options.signal);
    }
  }

  /** Takes a line, or the end of input, from the queued reads, or answers `undefined` for neither. */
  #take(secret: boolean): LineRead | undefined {
    while (this.#reads.length > 0) {
      const text = this.#reads[0] ?? '';
      let index = 0;
      while (index < text.length) {
        if (text[index] === '\u001b') {
          const end = sequenceEnd(text, index);
          if (end === undefined) {
            if (this.#reads.length === 1) {
              this.#reads[0] = text.slice(index);
              return undefined;
            }
            // The sequence goes on in the next read.
            this.#reads.splice(0, 2, text.slice(index) + (this.#reads[1] ?? ''));
            index = -1;
            break;
          }
          index = end;
          this.#carriage = false;
          continue;
        }
        const point = text.codePointAt(index) ?? 0;
        const character = String.fromCodePoint(point);
        index += character.length;
        if (character === '\n' && this.#carriage) {
          this.#carriage = false;
          continue;
        }
        this.#carriage = character === '\r';
        if (character === '\r' || character === '\n') {
          const value = this.#partial;
          this.#partial = '';
          this.#finish(index);
          return { kind: 'line', value };
        }
        if (character === '\u0004') {
          if (this.#partial === '') {
            this.#finish(index);
            return { kind: 'eof' };
          }
        } else if (character === '\u007f' || character === '\b') {
          this.#partial = graphemes(this.#partial).slice(0, -1).join('');
        } else if (secret && character === '\u0015') {
          this.#partial = '';
        } else if (secret && character === '\u0017') {
          this.#partial = withoutLastWord(this.#partial);
        } else if (point >= 32 && (point < 127 || point > 159)) {
          this.#partial += character;
        }
      }
      if (index !== -1) {
        this.#reads.shift();
        this.#restOfLast = false;
      }
    }
    return undefined;
  }

  /** Keeps what the first read holds after `index`, or drops the read when nothing is left. */
  #finish(index: number): void {
    const rest = (this.#reads[0] ?? '').slice(index);
    this.#restOfLast = rest !== '';
    if (rest === '') {
      this.#reads.shift();
    } else {
      this.#reads[0] = rest;
    }
  }

  /** Reads stdin once more, resolving at the next read and rejecting once `signal` aborts. */
  #more(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        signal.removeEventListener('abort', abort);
        this.#wake = undefined;
      };
      const abort = () => {
        done();
        reject(signal.reason);
      };
      this.#wake = () => {
        done();
        resolve();
      };
      signal.addEventListener('abort', abort, { once: true });
      this.#input.resume();
    });
  }

  /** One read: stdin pauses at once, so the next read waits until a question asks for it. */
  readonly #data = (chunk: Buffer | string) => {
    this.#input.pause();
    if (this.#interrupted) {
      return;
    }
    const { raised, rest } = raiseInterruptKeys(
      this.#context,
      typeof chunk === 'string' ? chunk : this.#decoder.write(chunk),
    );
    if (raised !== undefined) {
      // A raised interrupt drops every key still unread, as a terminal in its line mode does.
      this.#interrupted = raised === 'ending';
      this.drop();
      return;
    }
    if (rest !== '') {
      this.#reads.push(rest);
    }
    this.#wake?.();
  };

  readonly #end = () => {
    this.#context.cancel();
  };

  readonly #error = (error: unknown) => {
    this.#failure = { error };
    this.#wake?.();
  };
}

const inputs = new WeakMap<AbortSignal, LineInput>();

/** The run's line input, which every question of the run asked line by line shares. */
function lineInput(context: PromptContext<unknown>): LineInput {
  const existing = inputs.get(context.signal);
  if (existing !== undefined) {
    return existing;
  }
  const created = new LineInput(context);
  inputs.set(context.signal, created);
  return created;
}

/** A call that does nothing, which a resolver replaces. */
const nothing = (): void => undefined;

/** The end of the last turn each run's questions asked line by line have queued. */
const turns = new WeakMap<AbortSignal, Promise<void>>();

/**
 * Waits for this question's turn among the run's questions asked line by line, and answers the
 * call that gives the turn to the next one. Rejects with `signal`'s reason when it aborts first.
 */
async function takeTurn(context: PromptContext<unknown>, signal: AbortSignal): Promise<() => void> {
  const before = turns.get(context.signal) ?? Promise.resolve();
  let pass = nothing;
  const mine = new Promise<void>((resolve) => {
    pass = resolve;
  });
  turns.set(
    context.signal,
    before.then(() => mine),
  );
  let abort = nothing;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(signal.reason);
    };
  });
  try {
    signal.throwIfAborted();
    signal.addEventListener('abort', abort, { once: true });
    await Promise.race([before, aborted]);
  } catch (error) {
    pass();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
  return pass;
}

/** What a question asked line by line uses to print its pieces and read its answers. */
interface LineAsking {
  /** Aborts when the run is cancelled or core closes the question's region. */
  readonly signal: AbortSignal;
  /** The run's line input. */
  readonly input: LineInput;
  /** Prints one piece through `questionLine`. An asking row leaves its row open for the answer. */
  print(piece: QuestionLine): Promise<void>;
  /**
   * Prints one frame through another view, as the editor prints its frames, leaving its row open
   * for the answer when `opensRow` is true.
   */
  printFrame<Data>(data: Data, view: View<Data>, opensRow: boolean): Promise<void>;
  /**
   * Reads the answer's line. Ctrl-D on an empty line and stdin ending cancel the run, so the
   * question throws the run's reason.
   */
  read(secret?: boolean): Promise<string>;
  /** Sets what the question prints again when the process resumes after a suspend. */
  reasking(print: (() => Promise<void>) | undefined): void;
}

/** The pieces that leave their row open for the answer the operator types after them. */
const askingKinds: ReadonlySet<QuestionLine['kind']> = new Set([
  'text',
  'secret',
  'confirm',
  'number',
  'numbers',
  'search',
  'refine',
]);

/**
 * Asks one question line by line in the input region core opened for it, which is not live. The
 * question waits for its turn, prints nothing when core closes the region first, and prints its
 * cancelled line once, on a row of its own, by any path out without an answer. `body` answers
 * `{ value }`, and the region ends with the question.
 */
async function askLineByLine<Answer>(
  context: PromptContext<unknown>,
  question: { readonly message: string; readonly region: Region },
  body: (asking: LineAsking) => Promise<Answer>,
): Promise<Answer> {
  const { message, region } = question;
  const signal = AbortSignal.any([context.signal, region.signal]);
  const state = { answered: false, holding: false, left: false, rowOpen: false };
  const leave = () => {
    if (!state.holding || state.left || state.answered) {
      return;
    }
    state.left = true;
    if (state.rowOpen) {
      void context.out.draw('\n', controls);
    }
    void context.out.draw({ message }, cancelledLine);
  };
  // A cancellation, a failure, or a return closes the region, and the cancelled line prints then.
  region.signal.addEventListener(
    'abort',
    () => {
      if (region.closedBy !== 'end') {
        leave();
      }
    },
    { once: true },
  );
  const pass = await takeTurn(context, signal);
  state.holding = true;
  const input = lineInput(context);
  let reask: (() => Promise<void>) | undefined = undefined;
  const unresume = context.onResume(() => {
    input.clearLine();
    void reask?.();
  });
  input.open();
  const asking: LineAsking = {
    input,
    async print(piece) {
      await context.out.draw(piece, questionLine);
      state.rowOpen = askingKinds.has(piece.kind);
    },
    async printFrame(data, view, opensRow) {
      await context.out.draw(data, view);
      state.rowOpen = opensRow;
    },
    async read(secret = false) {
      const read = await input.line({ secret, signal });
      if (read.kind === 'eof') {
        context.cancel();
        context.signal.throwIfAborted();
      }
      state.rowOpen = false;
      return read.kind === 'line' ? read.value : '';
    },
    reasking(next) {
      reask = next;
    },
    signal,
  };
  try {
    const answer = await body(asking);
    state.answered = true;
    return answer;
  } finally {
    unresume();
    input.close();
    leave();
    if (region.closedBy === undefined) {
      await region.end();
    }
    pass();
  }
}

export { askLineByLine };
export type { LineAsking };
