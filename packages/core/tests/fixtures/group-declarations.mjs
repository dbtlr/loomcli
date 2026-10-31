import { Application, Command } from '../../dist/index.js';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { stdout: writeStdout } = fixture;
  try {
    const scenario = words[0];
    const base = new Command('export')
      .option('a', { type: 'boolean' })
      .option('b', { type: 'boolean' });
    const cases = {
      argument: () => base.argument('file', {}).oneRequired('a', 'file'),
      conditional: () =>
        new Command('export')
          .option('a', { required: 'non-interactive', type: 'string' })
          .option('b', { type: 'boolean' })
          .exclusive('a', 'b'),
      content: () =>
        new Command('export')
          .option('a', { required: true, stdin: true, type: 'content' })
          .option('b', { type: 'boolean' })
          .exclusive('a', 'b'),
      global: () =>
        new Application('groups')
          .globalOption('global', { type: 'boolean' })
          .option('a', { type: 'boolean' })
          .oneRequired('a', 'global'),
      minimum: () =>
        new Command('export')
          .option('a', { min: 1, multiple: true, type: 'content' })
          .option('b', { type: 'boolean' })
          .exclusive('a', 'b'),
      overlap: () => base.exclusive('a', 'b').requiredTogether('a', 'b'),
      redundancy: () =>
        new Command('export')
          .option('a', { required: true, type: 'string' })
          .option('b', { type: 'boolean' })
          .oneRequired('a', 'b')
          .oneRequired('b', 'a'),
      repeat: () => base.exclusive('a', 'a'),
      required: () =>
        new Command('export')
          .option('a', { required: true, type: 'string' })
          .option('b', { type: 'boolean' })
          .exclusive('a', 'b'),
      'reverse-overlap': () => base.requiredTogether('a', 'b').exclusive('a', 'b'),
      short: () => base.oneRequired('a'),
      unknown: () => base.exclusive('a', 'missing'),
    };
    try {
      cases[scenario]();
      writeStdout('accepted\n');
    } catch (error) {
      writeStdout(JSON.stringify({ message: error.message, name: error.name }));
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
