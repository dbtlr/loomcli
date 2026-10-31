import { Command } from '@loomcli/core';
import { createValidator } from '@loomcli/validators';

import { ownerName } from '../../helpers/build-facts.js';
import { targetOption } from '../../helpers/build-target.js';

/*
 * The action imports its work when it runs, so a run of any other command, help included, loads
 * none of it.
 */

const builds = ['development', 'distributed'] as const;

const buildOption = createValidator({
  inputSchema: { type: 'string', enum: [...builds] },
  parse: (raw) => {
    const match = builds.find((each) => each === raw);
    return match === undefined
      ? { issues: [{ message: 'Use development or distributed.' }] }
      : { value: match };
  },
});

const repositoryOption = createValidator({
  inputSchema: { type: 'string', pattern: ownerName.source },
  parse: (raw) =>
    ownerName.test(raw)
      ? { value: raw }
      : { issues: [{ message: 'Use owner/name, such as acme/notes.' }] },
});

export const buildCommand = new Command('build', {
  description: "Build the package's application for one target with its release facts baked in.",
})
  .option('target', {
    description:
      'Build for node, bun, or a Bun compile target, by default the host compile target on Linux and macOS.',
    type: 'string',
    validate: targetOption,
  })
  .option('out', {
    description:
      "Write to this path: a bundle's directory, by default dist/, or a binary's file, by default dist/<name>.",
    type: 'string',
  })
  .option('entry', {
    description: 'Build from this module, which calls run(), instead of src/main.ts.',
    type: 'string',
  })
  .option('application', {
    description:
      'Bundle this module, which exports the Application, instead of src/application.ts.',
    type: 'string',
  })
  .option('build', {
    description: 'Bake this build into the artifact instead of distributed.',
    type: 'string',
    validate: buildOption,
  })
  .option('watch', {
    description: 'Rebuild a development artifact on each change until stopped.',
    type: 'boolean',
  })
  .option('release', {
    description: "Bake the release group from package.json's version and repository.",
    type: 'boolean',
  })
  .option('repository', {
    description: 'Name the release repository as owner/name instead of the repository field.',
    type: 'string',
    validate: repositoryOption,
  })
  .option('name', {
    description: "Name the application for a binary's path and asset instead of package.json bin.",
    type: 'string',
  })
  .option('facts', {
    description: 'Print the release facts JSON and build nothing.',
    type: 'boolean',
  })
  .option('define', {
    description: 'Print the define pair __LOOM_RELEASE__=<json> and build nothing.',
    type: 'boolean',
  })
  .action(async (context) => {
    const { buildApplication } = await import('./build.js');
    await buildApplication(context);
  });
