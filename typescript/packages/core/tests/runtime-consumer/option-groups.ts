import { Application, InputError } from '@loomcli/core';
import type { OptionGroup } from '@loomcli/core';

const app = new Application('packed-groups', { description: 'Choose a document format.' })
  .option('json', { description: 'JSON output.', type: 'boolean' })
  .option('yaml', { description: 'YAML output.', type: 'boolean' })
  .exclusive('json', 'yaml')
  .oneRequired('json', 'yaml')
  .action(() => {});
const groups: readonly OptionGroup[] = app.inspect().root.optionGroups;
const accepted = await app.invoke([], { options: { json: true } });
const rejected = await app.invoke([], { options: { json: true, yaml: true } });
process.stdout.write(
  `${JSON.stringify({
    accepted: accepted.status,
    groups,
    rejected:
      rejected.status === 'failed' && rejected.failure instanceof InputError
        ? { exitCode: rejected.exitCode, problems: rejected.failure.problems }
        : null,
  })}\n`,
);
