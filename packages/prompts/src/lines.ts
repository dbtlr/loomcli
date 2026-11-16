import { escapeControlCharacters, style, width } from '@loomcli/core';
import type { Region, View } from '@loomcli/core';

import { controls } from './controls.js';
import { TypedLine } from './line.js';
import { openReader } from './reader.js';
import type { PromptContext } from './types.js';
import { cancelledLine, questionLine } from './views.js';
import type { QuestionLine } from './views.js';

/** A call that does nothing, which a resolver replaces. */
const nothing = (): void => undefined;

/**
 * The keys that edit a line asked line by line, whose cursor stays at its end: a character or a
 * paste joins it, Backspace removes its last grapheme, Ctrl-U clears it, and Ctrl-W removes its
 * last whitespace word. Every other key, an arrow or an Alt chord included, edits nothing.
 */
const editingKeys: ReadonlySet<string> = new Set([
  'text',
  'paste',
  'backspace',
  'killStart',
  'killWhitespace',
]);

/** The bytes a terminal in its line mode writes to erase `cells` columns before the cursor. */
function erasing(cells: number): string {
  return '\b \b'.repeat(cells);
}

/**
 * Echoes an edit that turned the line `before` into `after`: the text a key added, drawn as a
 * frame draws it, or the erasure of the cells the removed text took. The erasure goes straight to
 * stderr, because `out.draw` drops a control character on a terminal that does not redraw, and
 * the question's own writes before it have landed, since each echo awaits its draw.
 */
async function echo(
  context: PromptContext<unknown>,
  line: { readonly before: string; readonly after: string },
): Promise<void> {
  const { after, before } = line;
  if (after.startsWith(before)) {
    const added = after.slice(before.length);
    if (added !== '') {
      await context.out.draw(style.escape(escapeControlCharacters(added)), controls);
    }
    return;
  }
  const cells = width(escapeControlCharacters(before.slice(after.length)));
  if (cells > 0) {
    context.host.stderr.write(erasing(cells));
  }
}

/**
 * Waits for the input region's turn, which core gives the run's input regions one at a time, live
 * or not: a region that is not live draws nothing, and its draw resolves once its turn has come.
 * Rejects with `signal`'s reason when it aborts first.
 */
async function turn(region: Region, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let stop = nothing;
  const aborted = new Promise<never>((_resolve, reject) => {
    stop = () => {
      reject(signal.reason);
    };
  });
  signal.addEventListener('abort', stop, { once: true });
  try {
    await Promise.race([region.draw('', controls), aborted]);
  } finally {
    signal.removeEventListener('abort', stop);
  }
  signal.throwIfAborted();
}

/** Opens the run's key reader for a line-based question, ending the region when it cannot open. */
function heldReader(context: PromptContext<unknown>, region: Region) {
  try {
    return openReader(context, true);
  } catch (error) {
    void region.end();
    throw error;
  }
}

/** What a question asked line by line uses to print its pieces and read its answers. */
interface LineAsking {
  /** Aborts when the run is cancelled or core closes the question's region. */
  readonly signal: AbortSignal;
  /** Prints one piece through `questionLine`. An asking row leaves its row open for the answer. */
  print(piece: QuestionLine): Promise<void>;
  /**
   * Prints one frame through another view, as the editor prints its frames, leaving its row open
   * for the answer when `opensRow` is true.
   */
  printFrame<Data>(data: Data, view: View<Data>, opensRow: boolean): Promise<void>;
  /**
   * Reads the answer's line from the run's key reader, writing each typed character after the
   * asking row, and nothing at a secret, and the line break at Enter. Ctrl-D on an empty line and
   * stdin ending cancel the run, so the question throws the run's reason.
   */
  read(secret?: boolean): Promise<string>;
  /** Sets what the question prints again when the process resumes after a suspend. */
  reasking(print: (() => Promise<void>) | undefined): void;
  /** Discards the keys left from the read that held the last Enter, as an accepted secret does. */
  discardRest(): void;
  /** Discards the keys left from the reads an earlier question took, as an editor does. */
  discardTaken(): void;
  /** Lets stdin go and drops every queued key, while an editor reads the terminal. */
  lend(): void;
  /** Holds stdin again once the editor exits. */
  reclaim(): void;
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
 * question holds the run's key reader in raw mode from the start, as a question that redraws does,
 * writing no terminal control, waits for its region's turn, prints nothing when core closes the
 * region first, and prints its cancelled line once, on a row of its own, by any path out without
 * an answer. `body` answers the question, and the region ends with it.
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
  const keys = heldReader(context, region);
  // A cancellation, a failure, or a return closes the region, and the cancelled line prints then.
  region.signal.addEventListener(
    'abort',
    () => {
      if (region.closedBy === 'end') {
        return;
      }
      leave();
      if (region.closedBy !== 'cancellation') {
        keys.abandon(region.signal.reason);
      }
    },
    { once: true },
  );
  const line = new TypedLine();
  let reask: (() => Promise<void>) | undefined = undefined;
  let unresume = nothing;
  const asking: LineAsking = {
    discardRest() {
      keys.discard();
    },
    discardTaken() {
      keys.discardTaken();
    },
    lend() {
      keys.pause();
    },
    async print(piece) {
      await context.out.draw(piece, questionLine);
      state.rowOpen = askingKinds.has(piece.kind);
    },
    async printFrame(data, view, opensRow) {
      await context.out.draw(data, view);
      state.rowOpen = opensRow;
    },
    async read(secret = false) {
      while (true) {
        const key = await keys.read();
        if (key.kind === 'eof' && line.value === '') {
          context.cancel();
          context.signal.throwIfAborted();
        }
        if (key.kind === 'enter') {
          const { value } = line;
          line.value = '';
          line.cursor = 0;
          await context.out.draw('\n', controls);
          state.rowOpen = false;
          return value;
        }
        if (editingKeys.has(key.kind)) {
          const before = line.value;
          line.edit(key.kind, 'value' in key ? key.value : '');
          if (!secret) {
            await echo(context, { after: line.value, before });
          }
        }
      }
    },
    reasking(next) {
      reask = next;
    },
    reclaim() {
      keys.resume();
    },
    signal,
  };
  try {
    await turn(region, signal);
    state.holding = true;
    // The answer starts empty after a resume, as a terminal in its line mode discards the line.
    unresume = context.onResume(() => {
      line.value = '';
      line.cursor = 0;
      void reask?.();
    });
    const answer = await body(asking);
    state.answered = true;
    return answer;
  } finally {
    unresume();
    keys.close();
    leave();
    if (region.closedBy === undefined) {
      await region.end();
    }
  }
}

export { askLineByLine };
export type { LineAsking };
