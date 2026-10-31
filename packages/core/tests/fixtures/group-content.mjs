import { Application } from '../../dist/index.js';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess } = fixture;
  try {
    const [kind, ...argv] = fixtureWords;
    const declaration = new Application('groups', { description: 'Groups probe.' })
      .option('file', { description: 'Read a file or stdin.', stdin: true, type: 'content' })
      .option('url', { description: 'Read a URL.', type: 'string' });
    const app = declaration[kind]('file', 'url').action(({ options, out }) =>
      out.print(options.file?.kind ?? 'absent'),
    );
    fixture.exitCode = await app.run({ process: createProcess({ argv, env: {} }) });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
