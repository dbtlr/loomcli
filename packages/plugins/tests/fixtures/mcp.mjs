import { DeclarationError, processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { ruleText } from '../../../core/tests/fixtures/rule-text.mjs';
import { createScenario } from './mcp-app.ts';

const release = { build: process.env.FIXTURE_BUILD ?? 'distributed' };
const [name, ...argv] = process.argv.slice(2);

// A fault the call that declares it can detect throws before any run.
try {
  const application = createScenario(name, process.env);
  if (argv[0] === 'inspect') {
    application.inspect();
    process.stdout.write('inspected\n');
  } else {
    // A caller that owns the run aborts it on SIGUSR2, which the test sends as the caller's abort.
    const caller = new AbortController();
    if (process.env.FIXTURE_CALLER_SIGNAL !== undefined) {
      process.once('SIGUSR2', () => caller.abort());
    }
    process.exitCode = await application.run({
      process: processHandle({ argv, home: fixtureHome(), release }),
      signal: caller.signal,
    });
  }
} catch (error) {
  if (!(error instanceof DeclarationError)) {
    throw error;
  }
  process.stdout.write(`thrown:${error.exitCode}:${error.rule?.identity}: ${ruleText(error)}\n`);
}
