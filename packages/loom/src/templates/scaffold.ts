/** Text as a single-quoted TypeScript string literal. */
function quoted(text: string) {
  return `'${text.replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`)}'`;
}

/**
 * The application module a new scaffold writes to `src/application.ts`: an Application with a
 * description and one action, so the scaffold passes `loom check` and runs.
 */
export function applicationModule(name: string, identifier: string): string {
  return `import { Application } from '@loomcli/core';

export const ${identifier} = new Application(${quoted(name)}, {
  description: ${quoted(`Describe what ${name} does.`)},
}).action(({ out }) => out.print(${quoted(`${name} is ready. Replace this action with your own.`)}));
`;
}

/** The entry a new scaffold writes to `src/main.ts`, which runs the application module's Application. */
export function entryModule(identifier: string): string {
  return `#!/usr/bin/env node
import { ${identifier} } from './application.js';

await ${identifier}.run();
`;
}

/** The `package.json` init writes in an empty directory, before it adds the scaffold keys. */
export function newManifest(name: string): string {
  return `${JSON.stringify({ name, type: 'module', version: '0.0.0' }, undefined, 2)}\n`;
}
