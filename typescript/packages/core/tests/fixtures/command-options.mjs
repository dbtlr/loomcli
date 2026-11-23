import { Application, Command, DeclarationError } from '@loomcli/core';

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

    /** An options object with no prototype is plain data too, so either slot accepts one. */

    /** The second argument of each scenario: an options object. */
    const supplied = {
      'null-prototype': bare({ description: 'Reads one value.' }),
      'null-prototype-application': {},
      'options-object': { description: 'Reads one value.' },
    };

    /** The Application's own slot, which one scenario supplies with no prototype either. */
    const application = {
      'null-prototype-application': bare({ description: 'Reads one document.' }),
    };

    // Both constructors check their options slot, so a faulty one ends the fixture here.
    const app = declare(() => {
      const get = new Command('get', supplied[scenario]).action(({ out }) =>
        out.print('dispatched'),
      );
      return new Application('fixture', application[scenario]).command(get);
    });
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
      const code = await app.run({ process: createProcess({ argv: ['get'] }) });
      writeStdout(`resolved:${code}\n`);
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const bare = (entries) => Object.assign(Object.create(null), entries);

export { runFixture as run };
