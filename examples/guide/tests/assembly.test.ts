/*
 * Every chapter holds the assembly test `loom init` writes, which runs under bun test. This file
 * runs the same check on each chapter's Application under the repository's runner.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertAssembles } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { findApplication } from './transcripts.js';

const source = new URL('../src/', import.meta.url);

/** The chapter snapshots: each directory under `src/` that holds a `tsconfig.json`. */
const chapters = readdirSync(source, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => readdirSync(new URL(`${name}/`, source)).includes('tsconfig.json'))
  .toSorted();

test('the chapters include the first, so the check below is not vacuous', () => {
  expect(chapters).toContain('01-first-application');
});

test.each(chapters)('the application of chapter %s assembles', async (name) => {
  const path = fileURLToPath(new URL(`${name}/application.ts`, source));
  const application = findApplication(await import(/* @vite-ignore */ path), name);
  expect(() => assertAssembles(application)).not.toThrow();
});
