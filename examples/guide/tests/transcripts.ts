import { Writable } from 'node:stream';

import { Application } from '@loomcli/core';

/** The program name every transcript command line runs. */
const program = 'pace';

/** An environment assignment word: a name, an equals sign, and a value. */
const assignment = /^(?<name>[A-Za-z_][A-Za-z0-9_]*)=(?<value>[\s\S]*)$/u;

/** A transcript file read as data: how to run it and what it expects. */
interface Transcript {
  argv: string[];
  env: Record<string, string>;
  /** The expected combined stdout and stderr, exactly as the file holds it after line 1. */
  output: string;
  /** The expected exit status. */
  status: number;
}

/** Reads the quoted run that opens at `start`, and returns its text and where it ends. */
function readQuoted(line: string, start: number): { end: number; text: string } {
  const quote = line[start] ?? '';
  let text = '';
  let index = start + 1;
  while (line[index] !== quote) {
    if (index >= line.length) {
      throw new Error(`unterminated ${quote} quote in: ${line}`);
    }
    const char = line[index] ?? '';
    const next = line[index + 1] ?? '';
    if (quote === '"' && char === '\\' && (next === '"' || next === '\\')) {
      text += next;
      index += 2;
    } else {
      text += char;
      index += 1;
    }
  }
  return { end: index + 1, text };
}

/**
 * Splits a line into words the way a POSIX shell does for quoting alone. Single quotes keep
 * their text literally, double quotes honor a backslash before `"` or `\`, and a backslash
 * outside quotes escapes the next character. It throws on an unterminated quote.
 */
function splitWords(line: string): string[] {
  const words: string[] = [];
  let word = '';
  let started = false;
  let index = 0;
  while (index < line.length) {
    const char = line[index] ?? '';
    if (char === ' ' || char === '\t') {
      if (started) {
        words.push(word);
      }
      word = '';
      started = false;
      index += 1;
    } else if (char === "'" || char === '"') {
      const quoted = readQuoted(line, index);
      word += quoted.text;
      started = true;
      index = quoted.end;
    } else if (char === '\\') {
      word += line[index + 1] ?? '';
      started = true;
      index += 2;
    } else {
      word += char;
      started = true;
      index += 1;
    }
  }
  if (started) {
    words.push(word);
  }
  return words;
}

/** Parses a `$ [NAME=value ...] pace [argument ...]` line into its environment and arguments. */
function parseCommandLine(line: string): { argv: string[]; env: Record<string, string> } {
  if (!line.startsWith('$ ')) {
    throw new Error(`the first line of a transcript starts with "$ ", and this one is: ${line}`);
  }
  const words = splitWords(line.slice(2));
  const env: Record<string, string> = {};
  let index = 0;
  let groups = assignment.exec(words[0] ?? '')?.groups;
  while (groups?.name !== undefined) {
    env[groups.name] = groups.value ?? '';
    index += 1;
    groups = assignment.exec(words[index] ?? '')?.groups;
  }
  if (words[index] !== program) {
    throw new Error(
      `the command of a transcript runs "${program}" after any NAME=value assignments, and this one is: ${line}`,
    );
  }
  return { argv: words.slice(index + 1), env };
}

/** The expected exit status a transcript file name carries: `<name>.exit-<n>.txt`, else 0. */
function statusOf(fileName: string): number {
  const digits = /\.exit-(?<status>\d+)\.txt$/u.exec(fileName)?.groups?.status;
  return digits === undefined ? 0 : Number(digits);
}

/** Splits a transcript file into its command line and the output that follows it. */
function splitTranscript(text: string): { command: string; output: string } {
  const newline = text.indexOf('\n');
  return newline === -1
    ? { command: text, output: '' }
    : { command: text.slice(0, newline), output: text.slice(newline + 1) };
}

/** Reads a transcript file, given its file name and its text. */
function parseTranscript(fileName: string, text: string): Transcript {
  const { command, output } = splitTranscript(text);
  return { ...parseCommandLine(command), output, status: statusOf(fileName) };
}

/** The transcript file text for a run: the command line the file already has, then the output. */
function rewriteTranscript(text: string, output: string): string {
  return `${splitTranscript(text).command}\n${output}`;
}

/**
 * Runs the transcript's command in process with the public API, in the working directory `cwd`,
 * so a fixture such as a configuration file sits beside the transcripts that read it. The
 * environment holds only the transcript's assignments, color is off, and both streams append to
 * one buffer in write order.
 */
async function runTranscript(
  application: Application,
  transcript: Pick<Transcript, 'argv' | 'env'>,
  cwd: string,
): Promise<{ output: string; status: number }> {
  let output = '';
  const stream = () =>
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
  const status = await application.run({
    host: {
      argv: transcript.argv,
      cwd,
      env: transcript.env,
      stderr: stream(),
      stdout: stream(),
    },
    rendering: { color: 'never' },
  });
  return { output, status };
}

/** The one Application a snapshot module exports, under any export name. */
function findApplication(exports: Record<string, unknown>, snapshot: string): Application {
  const found = Object.values(exports).filter((value) => value instanceof Application);
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    throw new Error(
      `${snapshot}/application.ts must export exactly one Application, and it exports ${String(found.length)}.`,
    );
  }
  return only;
}

export {
  findApplication,
  parseCommandLine,
  parseTranscript,
  rewriteTranscript,
  runTranscript,
  splitWords,
};
export type { Transcript };
