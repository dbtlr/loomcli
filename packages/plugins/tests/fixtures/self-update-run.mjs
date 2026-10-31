import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { selfUpdateApplication } from './self-update-app.ts';

/**
 * One run of an application that installs `selfUpdate()`, against a fake GitHub that replaces
 * `fetch`. The scenario file names the release facts, the hook, where the run aborts, and what
 * GitHub serves; every request the fake answers is appended to the scenario's `requests` file.
 * An update notices scenario also names the terminals, the `program` that starts this fixture
 * again with its scenario, and an `events` file where each run and each refresh child records
 * when it started and ended and what the cache held then.
 */
const [scenarioPath, ...argv] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const controller = new AbortController();

/** Whether this process is the refresh child a run started, which runs in the cache directory. */
const child = argv.includes('--refresh-notice');

/** Appends one event, with the process it came from, to the scenario's events file. */
function record(event, details = {}) {
  if (scenario.events !== undefined) {
    appendFileSync(
      scenario.events,
      `${JSON.stringify({ event, role: child ? 'child' : 'run', ...details })}\n`,
    );
  }
}

/** What `update.json` in a directory holds, or `null` when nothing readable is there. */
function cacheIn(directory) {
  try {
    return readFileSync(join(directory, 'update.json'), 'utf8');
  } catch {
    return null;
  }
}

if (child) {
  record('start', { cache: cacheIn(process.cwd()), cwd: process.cwd() });
}

/** This process's group and session, from `/proc/self/stat`, the fields after the command's name. */
function session() {
  const stat = readFileSync('/proc/self/stat', 'utf8');
  // The fields after the name are the state, the parent, the group, and the session.
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return { group: Number(fields[2]), session: Number(fields[3]) };
}

if (scenario.session === true) {
  record('session', session());
}
process.on('exit', (code) => {
  record('exit', { cache: scenario.cache === undefined ? null : cacheIn(scenario.cache), code });
});

if (process.env.FIXTURE_UMASK !== undefined) {
  process.umask(Number.parseInt(process.env.FIXTURE_UMASK, 8));
}

/** The words that start this fixture again with its scenario, or the ones the scenario names. */
function program() {
  if (scenario.program === 'fixture') {
    return [process.execPath, fileURLToPath(import.meta.url), scenarioPath];
  }
  return scenario.program;
}

/** One output terminal, 80 columns by 24 rows. */
function output(isTTY) {
  return { columns: 80, isTTY, rows: 24 };
}

/** The terminals the scenario names, which an update notices run reports as terminals. */
function terminal() {
  if (scenario.tty === undefined) {
    return undefined;
  }
  return {
    stderr: output(scenario.tty.stderr),
    stdin: { isTTY: false },
    stdout: output(scenario.tty.stdout),
  };
}

const { app, fetch, stderr } = selfUpdateApplication(scenario, controller, {
  requested: (url) => record('request', { url }),
  writeStderr: (chunk) => process.stderr.write(chunk),
});
globalThis.fetch = fetch;
process.exitCode = await app.run({
  // The platform is pinned so the record directory reads the same row on every machine.
  process: processHandle({
    argv,
    env: { ...process.env, ...scenario.env },
    // The handle's home is the test's HOME as given, never the user database's.
    home: fixtureHome({ ...process.env, ...scenario.env }),
    platform: 'linux',
    release: scenario.release,
    stderr,
    ...(scenario.program === undefined ? {} : { program: program() }),
    ...(scenario.tty === undefined ? {} : { terminal: terminal() }),
  }),
  signal: controller.signal,
});
