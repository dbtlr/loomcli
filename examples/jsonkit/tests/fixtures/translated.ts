import { Application, plugin } from '@loomcli/core';

import { readJson } from '../../src/read-json.js';
import { invalidJson } from '../../src/translators.js';

/** A hook that reads the cause of the failure jsonkit's translator returned. */
const cause = plugin('@fixture/cause', {
  onFailure: (failure) => {
    process.stdout.write(`cause:${failure.cause?.constructor.name ?? 'none'}\n`);
    return undefined;
  },
});

/** The reader under jsonkit's translation, beside a hook the application itself does not install. */
const application = new Application('jsonkit', {
  description: 'Read one JSON document.',
  plugins: [cause],
  translators: [invalidJson],
}).action(async ({ host, out, style }) => {
  await readJson({ host, options: { file: undefined, verbose: 0 }, out, style });
});

process.exitCode = await application.run();
