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
})
  .option('file', {
    description: 'The document to read.',
    required: true,
    stdin: true,
    type: 'content',
  })
  .action(async ({ options, out, style }) => {
    await readJson({ options: { file: options.file }, out, style });
  });

process.exitCode = await application.run();
