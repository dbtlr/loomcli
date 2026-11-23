import { Writable } from 'node:stream';

import { Application } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const scenario = fixtureWords[0];
    const events = [];
    const mock = createProcess({ argv: [], record: false, release: { build: 'distributed' } });
    const fails = [
      'failed',
      'caught-write',
      'double-failed',
      'closed',
      'diagnostic-write',
    ].includes(scenario);
    // A separate destination is needed only when the scenario makes writes fail.
    const destination = fails
      ? new Writable({
          highWaterMark: 1,
          write(chunk, _encoding, callback) {
            setTimeout(() => {
              if (
                scenario === 'failed' ||
                scenario === 'caught-write' ||
                scenario === 'double-failed'
              ) {
                callback(new Error('Output failed.'));
              } else {
                events.push(chunk.toString());
                callback();
              }
            }, 5);
          },
        })
      : mock.stdout;
    if (!fails) {
      mock.stdout.cork();
      setTimeout(() => mock.stdout.uncork(), 5);
    }
    if (scenario === 'closed') {
      destination.destroy();
    }
    const beforeErrors = destination.listenerCount('error');
    let attempts = 0;
    if (scenario === 'diagnostic-write') {
      destination.write = () => {
        attempts++;
        throw new Error('Synchronous write failure.');
      };
    }
    const app = new Application('output').action(async ({ out }) => {
      if (scenario === 'chained') {
        out.print('one').then(() => out.print('two'));
        return;
      }
      if (scenario === 'diagnostic-write') {
        out.fatal('Expected failure.');
      }
      if (scenario === 'renderer-failed') {
        const error = new Error('render');
        Object.defineProperty(error, 'message', {
          get() {
            throw new Error('Cannot render.');
          },
        });
        throw error;
      }
      if (scenario === 'semantics') {
        out.print(' \ntext\t');
        out.info('info');
        out.success('success');
        out.warn('warn');
        out.error('error');
        return 'ignored';
      }
      if (scenario === 'caught-write') {
        try {
          await out.print('one');
        } catch {
          events.push('caught');
        }
      } else {
        out.print('one');
        out.print('two');
        out.print('three');
      }
    });
    const code = await app.run({
      process: fails
        ? {
            ...mock,
            stderr: ['double-failed', 'diagnostic-write'].includes(scenario)
              ? destination
              : mock.stderr,
            stdout: destination,
          }
        : mock,
    });
    fixture.exitCode = code;
    if (!fails) {
      events.push(
        ...mock.transcript.filter((write) => write.stream === 'stdout').map((write) => write.text),
      );
    }
    fixture.stderr(mock.stderr.text);
    writeStdout(
      `${JSON.stringify({
        code,
        events,
        listeners: destination.listenerCount('error') - beforeErrors,
        ...(scenario === 'diagnostic-write' ? { attempts } : {}),
      })}\n`,
    );
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
