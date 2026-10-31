import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Application, Command } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';
import { mockProcess } from '@loomcli/testing';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { externalProgram } from './in-process.ts';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], given = {}) {
  const env = given.env ?? {};
  let status = 0;
  const output = mockProcess({ env });
  const handles = [output];
  let captured = output;
  const capture = (fields) => {
    const { terminal, ...facts } = fields;
    const handle = mockProcess({
      env,
      ...facts,
      cwd: given.cwd,
      programs: {
        launchctl: externalProgram,
        loginctl: externalProgram,
        systemctl: externalProgram,
        ...Object.fromEntries(
          (facts.env?.PATH ?? '')
            .split(':')
            .flatMap((folder) =>
              ['systemctl', 'loginctl', 'launchctl', 'pwsh'].map((name) => [
                join(folder, name),
                externalProgram,
              ]),
            ),
        ),
      },
      uid: given.uid,
      ...(terminal !== undefined
        ? {
            terminal: {
              columns: terminal.stdout?.columns ?? terminal.stderr?.columns,
              rows: 24,
              streams: ['stdout', 'stderr'].filter((name) => terminal[name]?.isTTY),
              ...(terminal.background === undefined ? {} : { background: terminal.background }),
            },
          }
        : {}),
    });
    handles.push(handle);
    captured = handle;
    return handle;
  };

  /**
   * One run of an application named `jsonkit` that installs `completion()`. The scenario file, named
   * by `COMPLETION_SCENARIO`, holds the host's environment, working directory, and platform, the
   * umask, and the marker file whose appearance aborts the run, so a test sets every folder the
   * plugin reads and nothing reaches the real home.
   */
  const scenario = given;

  const controller = new AbortController();
  let timer = undefined;
  try {
    if (scenario.abortMarker !== undefined) {
      timer = setInterval(() => {
        if (existsSync(scenario.abortMarker)) {
          clearInterval(timer);
          controller.abort();
        }
      }, 10);
      timer.unref();
    }

    const app = new Application('jsonkit', {
      description: 'Read JSON.',
      plugins: [help(), completion()],
    }).command(
      new Command('ping', { description: 'Answer.' }).action(({ out }) => out.print('pong')),
    );

    status = await app.run({
      process: capture({
        argv: args,
        cwd: scenario.cwd,
        env: scenario.env,
        // The handle's home is the test's HOME as given, never the user database's.
        home: fixtureHome(scenario.env),
        platform: scenario.platform ?? 'linux',
        // A scenario with `columns` runs on a terminal that wide, so lanes wrap.
        ...(scenario.columns === undefined
          ? {}
          : {
              terminal: {
                stderr: { columns: scenario.columns, isTTY: true, rows: 24 },
                stdin: { isTTY: false },
                stdout: { columns: scenario.columns, isTTY: true, rows: 24 },
              },
            }),
      }),
      signal: controller.signal,
    });
  } finally {
    if (timer !== undefined) {
      clearInterval(timer);
    }
  }
  return {
    status: captured.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

export { run };
