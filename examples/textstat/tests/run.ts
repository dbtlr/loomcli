import type { Readable } from 'node:stream';

import { mockProcess } from '@loomcli/testing';

import { textstat } from '../src/application.js';

/** What one run left behind: its exit status, and everything it wrote to each stream. */
interface Result {
  readonly status: number | undefined;
  readonly stderr: string;
  readonly stdout: string;
}

/** The facts one run states beyond its command line. Every other fact is the mock's sealed default. */
interface Facts {
  /** The width of a terminal on stdout alone, which turns off colors, links, and modifiers. */
  readonly columns?: number;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly input?: string;
  readonly platform?: NodeJS.Platform;
}

/**
 * Runs textstat in this process on a mock process, the way a test that spawned its built
 * `dist/main.js` ran it, and reads back what the run printed and the status it ended with.
 */
async function run(argv: string[], facts: Facts = {}): Promise<Result> {
  const { columns, cwd, env, input, platform } = facts;
  const mock = mockProcess({
    argv,
    ...(cwd === undefined ? {} : { cwd }),
    ...(env === undefined ? {} : { env }),
    ...(platform === undefined ? {} : { platform }),
    stdin: input ?? '',
    ...(columns === undefined ? {} : { terminal: { columns, rows: 24, streams: ['stdout'] } }),
  });
  const status = await textstat.run({
    process: mock,
    ...(columns === undefined
      ? {}
      : { rendering: { color: 'never', hyperlinks: 'never', modifiers: 'never' } }),
  });
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** What the inspection reports, as the JSON document a test parses at its boundary. */
function inspection() {
  return { status: 0, stderr: '', stdout: JSON.stringify(textstat.inspect()) };
}

/**
 * Runs textstat as `run` does, reading the stream a test builds in place of the mock's own stdin,
 * so a test chooses where the chunks fall or how the read fails. `keyboard` states a terminal's
 * stdin, as an operator at a prompt has.
 */
async function runWithStdin(
  argv: string[],
  stdin: Readable,
  options: { cwd?: string; keyboard?: boolean } = {},
): Promise<Result> {
  const { cwd, keyboard = false } = options;
  const mock = mockProcess({
    argv,
    ...(cwd === undefined ? {} : { cwd }),
    ...(keyboard ? { terminal: { columns: 80, keys: [], rows: 24, streams: [] } } : { stdin: '' }),
  });
  const status = await textstat.run({ process: Object.create(mock, { stdin: { value: stdin } }) });
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** What one run printed on stdout, for a test that reads nothing else of it. */
async function printed(argv: string[], facts: Facts = {}): Promise<string> {
  const { stdout } = await run(argv, facts);
  return stdout;
}

export { inspection, printed, run, runWithStdin };
export type { Facts, Result };
