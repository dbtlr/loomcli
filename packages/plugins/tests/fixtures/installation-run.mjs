import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

/**
 * Runs the installed-files module of the built pack in its own process, as a plugin's Command
 * would. The one argument is a JSON request:
 *
 * - `record` and `files`, each file `{ path, content }` or `{ path, fill, size }` for `size` copies
 *   of the character `fill`, installed by the plugin `plugin`, `skill` when it names none;
 * - `folders`: installed folders `{ path, files }`, each file `{ path, content }`, listed with the files;
 * - `lines`: startup lines `{ path, line }`, listed with the files;
 * - `killAfterRename`: the path whose rename into place ends the process with SIGKILL;
 * - `killBeforeRename`: the path whose rename into place ends the process with SIGKILL first;
 * - `killAfterMoveAside`: the folder whose move aside, renamed away from that path, ends the process
 *   with SIGKILL, before the new folder is renamed into place;
 * - `killBeforeMkdir`: the directory whose creation ends the process with SIGKILL first;
 * - `killBeforeAppend` and `killAfterAppend`: the startup file whose append ends the process with
 *   SIGKILL, before or after the bytes land;
 * - `createBeforeCreate`: `{ path, content }`, a startup file another run creates with `content`
 *   right before this run's exclusive create of `path`, as when two runs add their lines at once;
 * - `appendAfterCreate`: `{ path, content }`, `content` another run appends right after this run's
 *   exclusive create of `path` and before its write, as when a run that found the file there
 *   appends its line at once;
 * - `rounds`: how many installs to run one after another, each failure caught and counted.
 *
 * The traps replace a `node:fs` function and resync the builtin's ESM exports, so they run under
 * Node alone. The fixture prints each outcome as one JSON line.
 */
const request = JSON.parse(process.argv[2]);

if (request.killAfterRename !== undefined || request.killBeforeRename !== undefined) {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === request.killBeforeRename) {
      process.kill(process.pid, 'SIGKILL');
    }
    rename(from, to);
    if (to === request.killAfterRename) {
      process.kill(process.pid, 'SIGKILL');
    }
  };
  syncBuiltinESMExports();
}
if (request.killAfterMoveAside !== undefined) {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    rename(from, to);
    if (from === request.killAfterMoveAside) {
      process.kill(process.pid, 'SIGKILL');
    }
  };
  syncBuiltinESMExports();
}
if (request.killBeforeMkdir !== undefined) {
  const mkdir = fs.mkdirSync;
  fs.mkdirSync = (path, options) => {
    if (path === request.killBeforeMkdir) {
      process.kill(process.pid, 'SIGKILL');
    }
    return mkdir(path, options);
  };
  syncBuiltinESMExports();
}
if (request.killBeforeAppend !== undefined || request.killAfterAppend !== undefined) {
  const append = fs.appendFileSync;
  fs.appendFileSync = (path, data, options) => {
    if (path === request.killBeforeAppend) {
      process.kill(process.pid, 'SIGKILL');
    }
    append(path, data, options);
    if (path === request.killAfterAppend) {
      process.kill(process.pid, 'SIGKILL');
    }
  };
  syncBuiltinESMExports();
}

/** The flags an exclusive create opens a file with, writing or appending. */
const exclusive = new Set(['wx', 'ax']);

if (request.createBeforeCreate !== undefined) {
  const open = fs.openSync;
  const { content, path: created } = request.createBeforeCreate;
  fs.openSync = (path, flags, mode) => {
    if (path === created && exclusive.has(flags)) {
      fs.writeFileSync(created, content);
    }
    return open(path, flags, mode);
  };
  syncBuiltinESMExports();
}
if (request.appendAfterCreate !== undefined) {
  const open = fs.openSync;
  const append = fs.appendFileSync;
  const { content, path: created } = request.appendAfterCreate;
  fs.openSync = (path, flags, mode) => {
    const descriptor = open(path, flags, mode);
    if (path === created && exclusive.has(flags)) {
      append(created, content);
    }
    return descriptor;
  };
  syncBuiltinESMExports();
}

const { install } = await import('../../dist/src/installation/files.js');

const files = request.files.map(({ content, fill, path, size }) => ({
  content: content ?? fill.repeat(size),
  path,
}));
const folders = request.folders ?? [];
const lines = request.lines ?? [];
const plugin = request.plugin ?? 'skill';
const signal = new AbortController().signal;
for (let round = 0; round < (request.rounds ?? 1); round += 1) {
  try {
    const outcome = install({
      files,
      folders,
      lines,
      plugin,
      record: request.record,
      signal,
    });
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ failed: error.code ?? error.message })}\n`);
  }
}
