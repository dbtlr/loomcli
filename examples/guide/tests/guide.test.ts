// @module-tag docs

// The guide's code and output are real. This file runs every transcript against its chapter
// Snapshot and checks that each fenced ts and console block in docs/guide/ equals its source.
// UPDATE_GUIDE=1 rewrites stale transcripts and stale bound blocks instead of failing.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { checkPage } from './guide-sync.js';
import {
  findApplication,
  parseTranscript,
  rewriteTranscript,
  runTranscript,
} from './transcripts.js';

/** The repository root, the base of every path a Markdown binding resolves to. */
const root = new URL('../../../', import.meta.url);
const guide = new URL('../', import.meta.url);
const pages = new URL('../../../docs/guide/', import.meta.url);

const update = process.env.UPDATE_GUIDE === '1';
const updateHint =
  'Run UPDATE_GUIDE=1 pnpm vp test --run examples/guide to rewrite it from the run.';

/** The files under a directory with the given extension, as sorted paths relative to it. */
function filesIn(directory: URL, extension: string): string[] {
  return readdirSync(directory, { encoding: 'utf8', recursive: true })
    .filter((path) => path.endsWith(extension))
    .toSorted();
}

/** Imports the Application that the chapter snapshot `slug` exports. */
async function loadSnapshot(slug: string) {
  const path = fileURLToPath(new URL(`src/${slug}/application.ts`, guide));
  return findApplication(await import(/* @vite-ignore */ path), `examples/guide/src/${slug}`);
}

/** Writes the run's output into a stale transcript when updating, and returns the output to expect. */
function settledOutput(file: URL, text: string, actual: string, recorded: string): string {
  if (update && actual !== recorded) {
    writeFileSync(file, rewriteTranscript(text, actual));
    return actual;
  }
  return recorded;
}

test.each(filesIn(new URL('transcripts/', guide), '.txt'))(
  'transcript %s is the real output of its snapshot',
  async (name) => {
    const file = new URL(`transcripts/${name}`, guide);
    const label = `examples/guide/transcripts/${name}`;
    const text = readFileSync(file, 'utf8');
    const transcript = parseTranscript(basename(name), text);
    const chapter = fileURLToPath(new URL(`transcripts/${dirname(name)}/`, guide));
    const run = await runTranscript(await loadSnapshot(dirname(name)), transcript, chapter);
    const expected = settledOutput(file, text, run.output, transcript.output);
    expect(run.output, `${label} is stale. ${updateHint}`).toBe(expected);
    expect(
      run.status,
      `${label} expects exit status ${String(transcript.status)} and the run ended with ${String(run.status)}. Rename the file to end in .exit-${String(run.status)}.txt, or drop the suffix for 0.`,
    ).toBe(transcript.status);
  },
);

/** The text of a repository-relative file, or undefined when it does not exist. */
function readRepositoryFile(path: string): string | undefined {
  try {
    return readFileSync(new URL(path, root), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

test.each(filesIn(pages, '.md').filter((path) => !path.includes('/')))(
  'docs/guide/%s binds every ts and console block to a real source',
  (name) => {
    const file = new URL(name, pages);
    const markdown = readFileSync(file, 'utf8');
    const { problems, updated } = checkPage({
      file: `docs/guide/${name}`,
      markdown,
      read: readRepositoryFile,
    });
    if (update && updated !== markdown) {
      writeFileSync(file, updated);
    }
    const remaining = problems.filter((problem) => !(update && problem.stale));
    expect(remaining.map((problem) => problem.message).join('\n')).toBe('');
  },
);
