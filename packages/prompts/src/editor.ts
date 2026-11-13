import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { escapeControlCharacters, FatalError } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

import { controls, pasteOff, showCursor } from './controls.js';
import { asking, validateAnswer } from './question.js';
import { openReader } from './reader.js';
import type { PromptContext } from './types.js';

/**
 * The failure of an editor question: the operator's editor could not start or exited with an error.
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

  /** The editor command that failed. */
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

/** Opens the operator's editor only after Enter, keeping its saved bytes until validation accepts. */
async function askEditor<Options, Output>(
  context: PromptContext<Options>,
  settings: {
    message: string;
    hint: string | undefined;
    extension?: string;
    validate?: StandardSchemaV1<string, Output>;
  } & ({ option?: string; argument?: never } | { argument: string; option?: never }),
): Promise<string | Output> {
  const command =
    [context.host.env.VISUAL, context.host.env.EDITOR].find((value) => value?.trim()) ?? 'vi';
  const quoted = escapeControlCharacters(command);
  const reader = openReader(context);
  const draw = asking(context, { kind: 'editor', message: settings.message }, reader);
  const signal = AbortSignal.any([context.signal, draw.signal]);
  let folder: string | undefined = undefined;
  let file = '';
  /** The bytes the file held when the editor last opened it, which a lost file is written back with. */
  let held: Uint8Array = new TextEncoder().encode(settings.hint ?? '');
  let saved = '';
  /** Whether the editor left no readable file in the answer's place, which Enter writes again. */
  let lost = false;
  let issue: string | undefined = undefined;
  let answered: { value: string; lines: number } | undefined = undefined;
  const cleanup = () => {
    if (folder !== undefined) {
      try {
        rmSync(folder, { force: true, recursive: true });
      } catch {
        /* Removal is best effort. */
      }
    }
  };
  const unshutdown = context.onShutdown(cleanup);
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
      try {
        if (folder === undefined) {
          folder = mkdtempSync(join(context.host.tmpdir, `${context.graph.name}-`));
          const extension = settings.extension ?? '';
          file = join(
            folder,
            `answer${extension === '' || extension.startsWith('.') ? extension : `.${extension}`}`,
          );
          writeFileSync(file, held, { flag: 'wx', mode: 0o600 });
        } else if (lost) {
          rmSync(file, { force: true, recursive: true });
          writeFileSync(file, held, { flag: 'wx', mode: 0o600 });
          lost = false;
        }
      } catch (error) {
        throw new EditorError(
          `Cannot write the editor's file in "${escapeControlCharacters(context.host.tmpdir)}" (${systemCode(error)}). Set TMPDIR to a folder you can write to, then run the command again.`,
          command,
          undefined,
        );
      }
      await frame(true);
      reader.pause();
      draw.lend(true);
      await context.out.draw(pasteOff + showCursor, controls);
      try {
        const exit = await context.out.lendTerminal(async () => {
          const child = context.host.spawn(
            '/bin/sh',
            ['-c', `exec 1>&2; exec ${command} "$@"`, command, file],
            {
              signal,
              stderr: 'inherit',
              stdin: 'inherit',
              stdout: 'ignore',
            },
          );
          const remove = context.onShutdown(() => {
            child.kill('SIGTERM');
            cleanup();
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
          throw new EditorError(
            `The editor "${quoted}" could not start. Set VISUAL or EDITOR to an editor you have installed, then run the command again.`,
            command,
            status,
          );
        }
        if (status !== 0) {
          throw new EditorError(
            `The editor "${quoted}" exited with code ${status}, so the question has no answer. To answer it, set VISUAL or EDITOR to another editor if you need one, then run the command again.`,
            command,
            status,
          );
        }
        let bytes: Buffer | undefined = undefined;
        try {
          bytes = readFileSync(file);
        } catch (error) {
          lost = true;
          const code = systemCode(error);
          issue =
            code === 'ENOENT'
              ? "The editor removed the answer's file. Save the answer before you close the editor."
              : `The question cannot read the answer's file (${code}). Save the answer as a file before you close the editor.`;
        }
        if (bytes !== undefined) {
          held = bytes;
          try {
            saved = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
          } catch {
            issue = 'The saved answer is not UTF-8 text. Save it as UTF-8.';
          }
        }
        if (issue === undefined) {
          const result = await validateAnswer(context, settings, saved);
          signal.throwIfAborted();
          if (result.issues === undefined) {
            const lines = saved === '' ? [] : saved.replace(/\r?\n$/u, '').split(/\r?\n/u);
            answered = {
              lines: lines.length,
              value: lines.find((line) => /[^\p{White_Space}\uFEFF]/u.test(line)) ?? '',
            };
            return result.value;
          }
          issue = result.issues[0]?.message ?? 'The answer is invalid.';
        }
      } finally {
        draw.lend(false);
      }
      reader.resume();
      await frame(false);
    }
  } finally {
    unshutdown();
    cleanup();
    const released = reader.close();
    if (!released) {
      reader.resume();
    }
    await draw.finish(answered, released);
  }
}

export { askEditor, EditorError };
