import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { InvokeOptions } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import type { MockProcess } from '@loomcli/testing';
import { expect } from 'vite-plus/test';

import { subject as jsonkit } from '../run.js';

/** A directory holding the documents, which both doors read through the same working directory. */
async function withDocuments<Value>(body: (cwd: string) => Promise<Value>): Promise<Value> {
  const directory = mkdtempSync(join(tmpdir(), 'loom-invoke-'));
  try {
    writeFileSync(join(directory, 'doc.json'), '{"name":"loom","a":1,"b":[true],"user":{"id":7}}');
    writeFileSync(join(directory, 'broken.json'), '{"name":');
    return await body(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** `run()` with argv on a mock process, on the same working directory `invoke` reads. */
async function viaArgv(argv: string[], cwd: string) {
  const mock = mockProcess({ argv, cwd });
  const code = await jsonkit.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** An invocation by name writes nothing to the process and sets no exit code. */
function expectUntouched(mock: MockProcess) {
  expect(mock.stdout.text).toBe('');
  expect(mock.stderr.text).toBe('');
  expect(mock.exitCode).toBeUndefined();
}

/** `invoke()` by name on a mock process whose working directory is `cwd`. */
async function named(path: string[], values: object, cwd: string, options: object = {}) {
  const mock = mockProcess({ cwd });
  const outcome = await jsonkit.invoke(path, values, { ...options, process: mock });
  expectUntouched(mock);
  return outcome;
}

/** The pinned invocations, each spelled as argv and as a path with named values. */
const wedge: { argv: string[]; options?: InvokeOptions; path: string[]; values: object }[] = [
  {
    argv: ['get', 'name', '-f', 'doc.json'],
    path: ['get'],
    values: { args: { path: 'name' }, options: { file: 'doc.json' } },
  },
  { argv: ['keys', '-f', 'doc.json'], path: ['keys'], values: { options: { file: 'doc.json' } } },
  {
    argv: ['select', '--field', 'a', '--field', 'b', '-f', 'doc.json'],
    path: ['select'],
    values: { options: { field: ['a', 'b'], file: 'doc.json' } },
  },
  {
    argv: ['paths', '--format', 'json', '-f', 'doc.json'],
    options: { view: 'json' },
    path: ['paths'],
    values: { options: { file: 'doc.json' } },
  },
  {
    argv: ['get', 'missing', '-f', 'doc.json'],
    path: ['get'],
    values: { args: { path: 'missing' }, options: { file: 'doc.json' } },
  },
  {
    argv: ['get', 'name', '-f', 'broken.json'],
    path: ['get'],
    values: { args: { path: 'name' }, options: { file: 'broken.json' } },
  },
  {
    argv: ['select', '--field', '', '-f', 'doc.json'],
    path: ['select'],
    values: { options: { field: [''], file: 'doc.json' } },
  },
  {
    argv: ['--verbos', '-f', 'doc.json'],
    path: [],
    values: { options: { file: 'doc.json', verbos: true } },
  },
];

/**
 * The JSON report for one scenario of the invocation by name, as the test parses it at its
 * boundary: each pinned invocation through both doors, the name errors, or an invocation by name
 * that reads no stdin and no color choice.
 */
export async function report(scenario: 'color' | 'names' | 'stdin' | 'wedge'): Promise<string> {
  if (scenario === 'wedge') {
    return withDocuments(async (cwd) => {
      const results = [];
      for (const { argv, options, path, values } of wedge) {
        results.push({
          argv: await viaArgv(argv, cwd),
          named: await named(path, values, cwd, options),
        });
      }
      return JSON.stringify(results);
    });
  }
  if (scenario === 'names') {
    return withDocuments(async (cwd) =>
      JSON.stringify({
        alias: await named(['ls'], { options: { file: 'doc.json' } }, cwd),
        argument: await named(['get'], { args: { pth: 'name' } }, cwd),
        help: await named(['get'], { options: { help: true } }, cwd),
        helpArgv: await viaArgv(['get', '--help'], cwd),
        unknown: await named(['nope'], {}, cwd),
      }),
    );
  }
  if (scenario === 'stdin') {
    // No file names the document, and content stdin is unavailable to an invocation by name.
    const mock = mockProcess();
    const outcome = await jsonkit.invoke(['get'], { args: { path: 'name' } }, { process: mock });
    expectUntouched(mock);
    return JSON.stringify(outcome);
  }
  // An invocation by name reads no color choice, so its help page stays plain whatever it names.
  const mock = mockProcess({ env: { FORCE_COLOR: '1' } });
  const outcome = await jsonkit.invoke(
    [],
    { options: { color: true, help: true } },
    { process: mock },
  );
  expectUntouched(mock);
  return JSON.stringify(outcome);
}
