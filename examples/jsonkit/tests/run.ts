import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type { RunOptions } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import type { MockFields } from '@loomcli/testing';
import { vi } from 'vite-plus/test';

import { jsonkit } from '../src/application.js';

// The source imports `get.md` as text, which only Loom's bundler and Bun resolve, so the test
// Supplies the same text from the file.
vi.mock('../src/commands/get.md', async () => {
  const { readFileSync } = await import('node:fs');
  return { default: readFileSync(new URL('../src/commands/get.md', import.meta.url), 'utf8') };
});

/** The application the tests run, which other test modules read from here so the mock below applies. */
const subject = jsonkit;

/** What one run left behind: its exit status, and everything it wrote to each stream. */
interface Result {
  readonly status: number | undefined;
  readonly stderr: string;
  readonly stdout: string;
}

/** The facts one run states beyond its command line. Every other fact is the mock's sealed default. */
interface Facts {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly input?: string;
  /** The terminal the run's output streams sit on; none when omitted, so every stream is piped. */
  readonly terminal?: {
    readonly columns: number;
    readonly streams?: readonly ('stdout' | 'stderr')[];
  };
  readonly programs?: MockFields['programs'];
  readonly rendering?: RunOptions['rendering'];
}

/**
 * Runs jsonkit in this process on a mock process, the way a test that spawned its built
 * `dist/main.js` ran it, and reads back what the run printed and the status it ended with.
 */
async function run(argv: string[], facts: Facts = {}): Promise<Result> {
  const { cwd, env, input, programs, rendering, terminal } = facts;
  const mock = mockProcess({
    argv,
    ...(cwd === undefined ? {} : { cwd }),
    ...(env === undefined ? {} : { env }),
    stdin: input ?? '',
    ...(programs === undefined ? {} : { programs }),
    ...(terminal === undefined ? {} : { terminal: { ...terminal, rows: 24 } }),
  });
  const status = await jsonkit.run({
    process: mock,
    ...(rendering === undefined ? {} : { rendering }),
  });
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/**
 * Runs jsonkit as `run` does, reading the stream a test builds in place of the mock's own stdin,
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
  const status = await jsonkit.run({ process: Object.create(mock, { stdin: { value: stdin } }) });
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** What the inspection reports, as the JSON document a test parses at its boundary. */
function inspection() {
  return { status: 0, stderr: '', stdout: JSON.stringify(jsonkit.inspect()) };
}

/** The document the host scenarios read. */
const contents = '{"name":"loom"}';

/** A document delivered on the connection, so the reader is exercised without a pipe. */
function documentStream() {
  return Readable.from([contents]);
}

/** A directory holding the document, so a file case reads a real path under a supplied cwd. */
async function withDocument<Value>(
  name: string,
  body: (cwd: string) => Promise<Value>,
): Promise<Value> {
  const directory = mkdtempSync(join(tmpdir(), 'loom-host-'));
  try {
    writeFileSync(join(directory, name), contents);
    return await body(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** The scenarios that need a host stream of their own: failing, closing, and terminal stdin. */
function host(scenario: string): Promise<Result> {
  switch (scenario) {
    case 'cwd': {
      return withDocument('-data.json', (cwd) =>
        run(['get', 'name', '--file', './-data.json'], { cwd }),
      );
    }
    case 'stdin': {
      return runWithStdin(['get', 'name'], documentStream());
    }
    case 'terminal': {
      return runWithStdin(['get', 'name'], documentStream(), { keyboard: true });
    }
    case 'terminal-doctor': {
      return runWithStdin(['doctor'], Readable.from([]), { keyboard: true });
    }
    case 'terminal-file': {
      return withDocument('data.json', (cwd) =>
        runWithStdin(['get', 'name', '--file', 'data.json'], documentStream(), {
          cwd,
          keyboard: true,
        }),
      );
    }
    case 'unreadable': {
      const stdin = new Readable({
        read() {
          this.destroy(new Error('The connection failed.'));
        },
      });
      return runWithStdin(['get', 'name'], stdin);
    }
    case 'closed-early': {
      // A connection destroyed without an error emits "close" and never "end".
      let sent = false;
      const stdin = new Readable({
        read() {
          if (sent) {
            this.destroy();
            return;
          }
          sent = true;
          this.push(contents);
        },
      });
      return runWithStdin(['get', 'name'], stdin);
    }
    default: {
      // File-only: a supplied file leaves the stream unread.
      let reads = 0;
      const stdin = new Readable({
        read() {
          reads++;
          this.push(null);
        },
      });
      return withDocument('data.json', async (cwd) => {
        const result = await runWithStdin(['get', 'name', '--file', 'data.json'], stdin, { cwd });
        return { ...result, stdout: `${result.stdout}${reads}\treads\n` };
      });
    }
  }
}

/** What one run printed on stdout, for a test that reads nothing else of it. */
async function printed(argv: string[], facts: Facts = {}): Promise<string> {
  const { stdout } = await run(argv, facts);
  return stdout;
}

export { host, inspection, printed, run, runWithStdin, subject };
export type { Facts, Result };
