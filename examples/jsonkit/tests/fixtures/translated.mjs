import { Application, plugin } from '@loomcli/core';

import { readJson } from '../../dist/src/read-json.js';
import { invalidJson } from '../../dist/src/translators.js';

/** A hook that reads the cause of the failure jsonkit's translator returned. */
const cause = plugin('@fixture/cause', {
  onFailure: (failure) => {
    process.stdout.write(`cause:${failure.cause?.constructor.name ?? 'none'}\n`);
    return undefined;
  },
});

/** The reader under jsonkit's translation, beside a hook the application itself does not install. */
const application = new Application('jsonkit', {
  plugins: [cause],
  translators: [invalidJson],
}).action(async ({ host }) => {
  await readJson(undefined, host);
});

process.exitCode = await application.run();
