import { Application, DeclarationError } from '@loomcli/core';

import { ruleText } from './rule-text.mjs';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;

  function declare(build) {
    try {
      return build();
    } catch (error) {
      if (!(error instanceof DeclarationError)) {
        throw error;
      }
      writeStdout(`thrown:${error.exitCode}: ${ruleText(error)}\n`);
      throw fixture.stopped;
    }
  }
  try {
    const scenario = words[0];
    const mode = words[1];

    /** The second argument of each scenario: an options object. */
    const supplied = {
      'options-object': { description: 'Example application.' },
    };

    // The constructor checks the options slot, so a faulty one ends the fixture here.
    const app = declare(() =>
      new Application('fixture', supplied[scenario]).action(({ out }) => out.print('dispatched')),
    );
    writeStdout('assembled\n');

    if (mode === 'inspect') {
      try {
        app.inspect();
        writeStdout('inspected\n');
      } catch (error) {
        const kind = error instanceof DeclarationError ? 'declaration' : 'other';
        writeStdout(`${kind}:${error.exitCode}: ${ruleText(error)}\n`);
      }
    } else {
      const code = await app.run({ process: createProcess({ argv: [] }) });
      writeStdout(`resolved:${code}\n`);
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
