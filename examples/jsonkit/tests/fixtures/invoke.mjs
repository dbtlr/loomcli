import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { processHandle } from '@loomcli/core';

import { jsonkit } from '../../dist/application.js';

const scenario = process.argv[2];

const piped = {
  stderr: { columns: undefined, isTTY: false, rows: undefined },
  stdin: { isTTY: false },
  stdout: { columns: undefined, isTTY: false, rows: undefined },
};

/** A stream that records every byte written to it, as a sink host's stdout and stderr do. */
function sink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}

/** A directory holding the documents, which both doors read through the same working directory. */
async function withDocuments(run) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-invoke-'));
  try {
    writeFileSync(join(directory, 'doc.json'), '{"name":"loom","a":1,"b":[true],"user":{"id":7}}');
    writeFileSync(join(directory, 'broken.json'), '{"name":');
    await run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** `run()` with argv and a sink host, on the same working directory `invoke` reads. */
async function viaArgv(argv, cwd) {
  const stdout = sink();
  const stderr = sink();
  const code = await jsonkit.run({
    process: processHandle({
      argv,
      cwd,
      stderr: stderr.stream,
      stdin: Readable.from([]),
      stdout: stdout.stream,
      terminal: piped,
    }),
  });
  return { code, stderr: stderr.text(), stdout: stdout.text() };
}

/** The pinned invocations, each spelled as argv and as a path with named values. */
const wedge = [
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

if (scenario === 'wedge') {
  await withDocuments(async (cwd) => {
    const results = [];
    for (const { argv, options, path, values } of wedge) {
      const argvResult = await viaArgv(argv, cwd);
      const named = await jsonkit.invoke(path, values, {
        ...options,
        process: processHandle({ cwd }),
      });
      results.push({ argv: argvResult, named });
    }
    process.stdout.write(`${JSON.stringify(results)}\n`);
  });
  // Each `run()` set the process's exit status, which the fixture's own status does not report.
  process.exitCode = 0;
} else if (scenario === 'names') {
  await withDocuments(async (cwd) => {
    const host = { cwd };
    const results = {
      alias: await jsonkit.invoke(
        ['ls'],
        { options: { file: 'doc.json' } },
        { process: processHandle(host) },
      ),
      argument: await jsonkit.invoke(
        ['get'],
        { args: { pth: 'name' } },
        { process: processHandle(host) },
      ),
      help: await jsonkit.invoke(
        ['get'],
        { options: { help: true } },
        { process: processHandle(host) },
      ),
      helpArgv: await viaArgv(['get', '--help'], cwd),
      unknown: await jsonkit.invoke(['nope'], {}, { process: processHandle(host) }),
    };
    process.stdout.write(`${JSON.stringify(results)}\n`);
  });
  process.exitCode = 0;
} else if (scenario === 'stdin') {
  // No file names the document, and content stdin is unavailable to an invocation by name.
  const outcome = await jsonkit.invoke(['get'], { args: { path: 'name' } });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
} else if (scenario === 'color') {
  // An invocation by name reads no color choice, so its help page stays plain whatever it names.
  const outcome = await jsonkit.invoke([], { options: { color: true, help: true } });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}
