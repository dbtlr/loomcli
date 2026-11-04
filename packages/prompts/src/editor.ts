import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { escapeControlCharacters, FatalError } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

import { controls, pasteOff, showCursor } from './controls.js';
import { asking, validateAnswer } from './question.js';
import { openReader } from './reader.js';
import type { PromptContext } from './types.js';

class EditorError extends FatalError {
  static override readonly code = 'editor-failed';

  readonly editor: string;
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
  reader.discardAll();
  const draw = asking(context, { kind: 'editor', message: settings.message }, reader);
  const signal = AbortSignal.any([context.signal, draw.signal]);
  let folder: string | undefined = undefined;
  let file = '';
  let saved = settings.hint ?? '';
  let missing = false;
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
          writeFileSync(file, saved, { flag: 'wx', mode: 0o600 });
        } else if (missing) {
          writeFileSync(file, saved, { flag: 'wx', mode: 0o600 });
          missing = false;
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
          if (systemCode(error) !== 'ENOENT') {
            throw error;
          }
          missing = true;
          issue =
            "The editor removed the answer's file. Save the answer before you close the editor.";
        }
        if (bytes !== undefined) {
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
