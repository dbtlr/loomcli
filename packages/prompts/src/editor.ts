import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FatalError } from '@loomcli/core';
import type { Region, StandardSchemaV1 } from '@loomcli/core';

import { controls, pasteOff, showCursor } from './controls.js';
import { askLineByLine } from './lines.js';
import {
  answerFileRemoved,
  answerFileUnreadable,
  answerNotUtf8,
  editorExited,
  editorFileUnwritable,
  editorNotStarted,
  invalidAnswer,
} from './messages.js';
import { asking, liveReader, validateAnswer } from './question.js';
import type { PromptContext } from './types.js';
import { answeredLine, questionFrame } from './views.js';

/**
 * The failure of an editor question that cannot get an answer from the operator's editor: the
 * question cannot write its file, the editor cannot start, or the editor exits with an error.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { editor, EditorError } from '@loomcli/prompts';
 *
 * export const note = new Command('note').action(async (context) => {
 *   try {
 *     const body = await editor(context, { message: 'Note', extension: '.md' });
 *     await context.out.info(body);
 *   } catch (error) {
 *     if (error instanceof EditorError) {
 *       await context.out.error(`${error.editor} failed.`);
 *     }
 *     throw error;
 *   }
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#when-the-editor-fails
 * @public
 * @sealed
 */
class EditorError extends FatalError {
  /** The stable code that names this failure. */
  static override readonly code = 'editor-failed';

  /** The command line the question ran as the editor. */
  readonly editor: string;
  /** The editor's exit status, or `undefined` when it did not exit with one. */
  readonly status: number | undefined;

  constructor(message: string, editor: string, status: number | undefined) {
    super(message);
    this.name = 'EditorError';
    this.editor = editor;
    this.status = status;
  }
}

function systemCode(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
}

/** An editor question's settings, as the library resolves them. */
type EditorQuestion<Output> = {
  message: string;
  hint: string | undefined;
  extension?: string;
  validate?: StandardSchemaV1<string, Output>;
} & ({ option?: string; argument?: never } | { argument: string; option?: never });

/** What one opening of the editor ends in: the issue that refuses the saved text, or the answer. */
type Edited<Output> =
  | { readonly issue: string }
  | {
      readonly answer: {
        readonly output: string | Output;
        readonly value: string;
        readonly lines: number;
      };
    };

/**
 * The answer's file across the openings of the editor one question makes: the private folder it
 * creates at the first Enter, the bytes the file held when the editor last opened it, and whether
 * the editor left no readable file in the answer's place, which the next Enter writes again.
 */
class AnswerFile<Options, Output> {
  #folder: string | undefined = undefined;
  #file = '';
  #held: Uint8Array;
  #lost = false;
  readonly #context: PromptContext<Options>;
  readonly #settings: EditorQuestion<Output>;
  readonly #command: string;
  readonly #unshutdown: () => void;

  constructor(context: PromptContext<Options>, settings: EditorQuestion<Output>, command: string) {
    this.#context = context;
    this.#settings = settings;
    this.#command = command;
    this.#held = new TextEncoder().encode(settings.hint ?? '');
    this.#unshutdown = context.onShutdown(() => {
      this.#remove();
    });
  }

  /** Removes the folder, and the handler that removes it at a shutdown. */
  close(): void {
    this.#unshutdown();
    this.#remove();
  }

  #remove(): void {
    if (this.#folder !== undefined) {
      try {
        rmSync(this.#folder, { force: true, recursive: true });
      } catch {
        /* Removal is best effort. */
      }
    }
  }

  /** Writes the file the editor opens: at the first Enter, and again after the editor lost it. */
  write(): void {
    const context = this.#context;
    try {
      if (this.#folder === undefined) {
        this.#folder = mkdtempSync(join(context.host.tmpdir, `${context.graph.name}-`));
        const extension = this.#settings.extension ?? '';
        this.#file = join(
          this.#folder,
          `answer${extension === '' || extension.startsWith('.') ? extension : `.${extension}`}`,
        );
        writeFileSync(this.#file, this.#held, { flag: 'wx', mode: 0o600 });
      } else if (this.#lost) {
        rmSync(this.#file, { force: true, recursive: true });
        writeFileSync(this.#file, this.#held, { flag: 'wx', mode: 0o600 });
        this.#lost = false;
      }
    } catch (error) {
      throw new EditorError(
        editorFileUnwritable(context.host.tmpdir, systemCode(error)),
        this.#command,
        undefined,
      );
    }
  }

  /**
   * Lends the terminal to the editor on the file, and answers the issue that refuses what it
   * saved, or the validated answer.
   */
  async edit(signal: AbortSignal): Promise<Edited<Output>> {
    const context = this.#context;
    const command = this.#command;
    const exit = await context.out.lendTerminal(async () => {
      const child = context.host.spawn(
        '/bin/sh',
        ['-c', `exec 1>&2; exec ${command} "$@"`, command, this.#file],
        {
          signal,
          stderr: 'inherit',
          stdin: 'inherit',
          stdout: 'ignore',
        },
      );
      const remove = context.onShutdown(() => {
        child.kill('SIGTERM');
        this.#remove();
      });
      try {
        return await child.exited;
      } finally {
        remove();
      }
    });
    signal.throwIfAborted();
    const status = exit.kind === 'exited' ? exit.code : undefined;
    if (status === undefined || status === 126 || status === 127) {
      throw new EditorError(editorNotStarted(command), command, status);
    }
    if (status !== 0) {
      throw new EditorError(editorExited(command, status), command, status);
    }
    let bytes: Buffer | undefined = undefined;
    try {
      bytes = readFileSync(this.#file);
    } catch (error) {
      this.#lost = true;
      const code = systemCode(error);
      return { issue: code === 'ENOENT' ? answerFileRemoved : answerFileUnreadable(code) };
    }
    this.#held = bytes;
    let saved = '';
    try {
      saved = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return { issue: answerNotUtf8 };
    }
    const result = await validateAnswer(context, this.#settings, saved);
    signal.throwIfAborted();
    if (result.issues !== undefined) {
      return { issue: result.issues[0]?.message ?? invalidAnswer };
    }
    const lines = saved === '' ? [] : saved.replace(/\r?\n$/u, '').split(/\r?\n/u);
    return {
      answer: {
        lines: lines.length,
        output: result.value,
        value: lines.find((line) => /[^\p{White_Space}\uFEFF]/u.test(line)) ?? '',
      },
    };
  }
}

/** Opens the operator's editor only after Enter, keeping its saved bytes until validation accepts. */
async function askEditor<Options, Output>(
  context: PromptContext<Options>,
  settings: EditorQuestion<Output>,
): Promise<string | Output> {
  const command =
    [context.host.env.VISUAL, context.host.env.EDITOR].find((value) => value?.trim()) ?? 'vi';
  // A region that is not live is a terminal that does not move its cursor, so it asks line by line.
  const region = context.out.region({ input: true });
  if (!region.live) {
    return askEditorLines(context, settings, { command, region });
  }
  const reader = liveReader(context, region);
  const draw = asking(context, { kind: 'editor', message: settings.message }, { reader, region });
  const signal = AbortSignal.any([context.signal, draw.signal]);
  const file = new AnswerFile(context, settings, command);
  let issue: string | undefined = undefined;
  let answered: { value: string; lines: number } | undefined = undefined;
  const frame = (editing: boolean) =>
    draw.frame({ editing, issue, kind: 'editor', message: settings.message });
  try {
    await frame(false);
    // The question shows now, so keys left from the reads an earlier question took are not its own.
    reader.discardTaken();
    while (true) {
      const key = await reader.read();
      if (key.kind === 'eof') {
        context.cancel();
        context.signal.throwIfAborted();
      }
      if (key.kind !== 'enter') {
        continue;
      }
      issue = undefined;
      file.write();
      await frame(true);
      reader.pause();
      draw.lend(true);
      await context.out.draw(pasteOff + showCursor, controls);
      let edited: Edited<Output> | undefined = undefined;
      try {
        edited = await file.edit(signal);
      } finally {
        draw.lend(false);
      }
      if ('answer' in edited) {
        answered = { lines: edited.answer.lines, value: edited.answer.value };
        return edited.answer.output;
      }
      issue = edited.issue;
      reader.resume();
      await frame(false);
    }
  } finally {
    file.close();
    const released = reader.close();
    if (!released) {
      reader.resume();
    }
    await draw.finish(answered, released);
  }
}

/**
 * Asks an editor question line by line. Its interaction is unchanged, and each frame is printed
 * once: the asking frame, the editing frame on the row after the Enter, ended with a line break
 * before the editor starts, and the answered line once the editor exits. A rejected answer prints
 * its issue and the asking frame again. The question lets stdin go while the editor reads the
 * terminal, as it does when it redraws, so the editor reads every key.
 */
async function askEditorLines<Options, Output>(
  context: PromptContext<Options>,
  settings: EditorQuestion<Output>,
  held: { readonly command: string; readonly region: Region },
): Promise<string | Output> {
  const { command, region } = held;
  const { message } = settings;
  const file = new AnswerFile(context, settings, command);
  try {
    return await askLineByLine(context, { message, region }, async (line) => {
      let lent = false;
      const frame = (editing: boolean) =>
        line.printFrame(
          { editing, issue: undefined, kind: 'editor', message },
          questionFrame,
          !editing,
        );
      line.reasking(() => (lent ? Promise.resolve() : frame(false)));
      await frame(false);
      // The question shows now, so keys left from the reads an earlier question took are not its own.
      line.discardTaken();
      while (true) {
        // Whatever the line held before Enter is ignored.
        await line.read();
        file.write();
        await frame(true);
        await context.out.draw('\n', controls);
        line.lend();
        lent = true;
        let edited: Edited<Output> | undefined = undefined;
        try {
          edited = await file.edit(line.signal);
        } finally {
          lent = false;
          line.reclaim();
        }
        if ('answer' in edited) {
          await line.printFrame(
            { answer: edited.answer.value, kind: 'editor', lines: edited.answer.lines, message },
            answeredLine,
            false,
          );
          return edited.answer.output;
        }
        await line.print({ issue: edited.issue, kind: 'issue' });
        await frame(false);
      }
    });
  } finally {
    file.close();
  }
}

export { askEditor, EditorError };
