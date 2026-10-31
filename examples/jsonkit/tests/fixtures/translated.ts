import { Application, plugin } from '@loomcli/core';

import { readJson } from '../../src/read-json.js';
import { invalidJson } from '../../src/translators.js';

/**
 * The reader under jsonkit's translation, beside a hook the application itself does not install.
 * The hook reads the cause of the failure jsonkit's translator returned and reports it to `report`.
 */
export function translated(report: (line: string) => void) {
  const cause = plugin('@fixture/cause', {
    onFailure: (failure) => {
      report(`cause:${failure.cause?.constructor.name ?? 'none'}\n`);
      return undefined;
    },
  });
  return new Application('jsonkit', {
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
}
