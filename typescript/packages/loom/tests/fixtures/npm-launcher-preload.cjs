/*
 * Loaded with `node -r` ahead of an npm launcher under test, each part turned on by a variable.
 *
 * - `NPM_LAUNCHER_CEILING` ceils the launcher's walk up to `node_modules` at the sandbox root, so a
 *   platform package that sits above the temporary directory on the machine running the tests
 *   never resolves. `NODE_PATH` is not ceiled.
 * - `NPM_LAUNCHER_SPAWN` removes `process.execve` before the launcher loads, so it takes the spawn
 *   path a Node without the call takes.
 * - `NPM_LAUNCHER_MUSL` removes `glibcVersionRuntime` from the runtime's report, as a musl Node's
 *   report has none.
 * - `NPM_LAUNCHER_EXECVE_THROWS` makes `process.execve` throw an error with that code, as a Node
 *   from 26 throws where an older one ends the process.
 * - `NPM_LAUNCHER_SPAWN_MISSING` makes `child_process.spawn` start a file that does not exist, so
 *   the child emits its `error` event.
 * - `NPM_LAUNCHER_HOLD` adds a listener for that signal, so a raise of it does not end the
 *   launcher.
 */
const childProcess = require('node:child_process');
const Module = require('node:module');
const { sep } = require('node:path');

const ceiling = process.env.NPM_LAUNCHER_CEILING;

/** Node's own list of the `node_modules` directories a lookup from a directory walks. */
const lookupPaths = '_nodeModulePaths';

if (ceiling !== undefined) {
  const walked = Module[lookupPaths];
  Module[lookupPaths] = (from) =>
    walked(from).filter((path) => path === ceiling || path.startsWith(`${ceiling}${sep}`));
}

if (process.env.NPM_LAUNCHER_SPAWN === '1') {
  delete process.execve;
}

if (process.env.NPM_LAUNCHER_MUSL === '1') {
  const getReport = process.report.getReport.bind(process.report);
  process.report.getReport = (...args) => {
    const report = getReport(...args);
    delete report.header.glibcVersionRuntime;
    return report;
  };
}

const thrown = process.env.NPM_LAUNCHER_EXECVE_THROWS;

if (thrown !== undefined) {
  process.execve = () => {
    throw Object.assign(new Error('process.execve failed'), { code: thrown });
  };
}

if (process.env.NPM_LAUNCHER_SPAWN_MISSING === '1') {
  const { spawn } = childProcess;
  childProcess.spawn = (file, ...rest) => spawn(`${file}.missing`, ...rest);
}

const held = process.env.NPM_LAUNCHER_HOLD;

if (held !== undefined) {
  process.on(held, () => undefined);
}
