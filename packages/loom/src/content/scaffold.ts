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

/**
 * How the entry imports the Application: by the name the application module exports it under, or
 * as the module's default export, bound to an identifier of the entry's own.
 */
export interface ApplicationImport {
  readonly identifier: string;
  readonly kind: 'default' | 'named';
}

/** The entry a scaffold writes to `src/main.ts`, which runs the application module's Application. */
export function entryModule({ identifier, kind }: ApplicationImport): string {
  const binding = kind === 'named' ? `{ ${identifier} }` : identifier;
  return `#!/usr/bin/env node
import ${binding} from './application.js';

await ${identifier}.run();
`;
}

/** The `package.json` init writes in an empty directory, before it adds the scaffold keys. */
export function newManifest(name: string): string {
  return `${JSON.stringify({ name, type: 'module', version: '0.0.0' }, undefined, 2)}\n`;
}
