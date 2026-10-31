---
description: The @loomcli/eslint-plugin reference. The lint rules that guide an application author where a type cannot, how to load them in oxlint and ESLint, how the rules find a declaration and a read of the process, and what each rule reports and leaves alone.
---

# ESLint plugin reference

`@loomcli/eslint-plugin` ships the [lint rules](../glossary.md) for Loom applications. A lint rule guides an author where a type cannot express the guidance, and it reports in the editor and in CI before anything runs. [ADR-0098](../decisions/0098-lint-is-the-author-guidance-lane.md) records the decision. The plugin is ESLint-compatible, so oxlint loads it through its `jsPlugins` setting and ESLint loads it as a flat-config plugin. Both tools run the same rules.

The package has a peer dependency on `@loomcli/core`, because the `name-shape` rule calls the same name predicates core does. It needs no type information, so it runs under oxlint, which provides none.

## Install and configure

Install the plugin as a development dependency of the application, beside `@loomcli/core`:

```sh
npm install --save-dev @loomcli/eslint-plugin
```

### oxlint

Put the plugin's `configs.oxlint` object in `.oxlintrc.json`, as it is:

```json
{
  "jsPlugins": [
    "@loomcli/eslint-plugin"
  ],
  "rules": {
    "@loomcli/discarded-declaration": "error",
    "@loomcli/host-bypass": "error",
    "@loomcli/name-shape": "error",
    "@loomcli/strict-configuration-schema": "error",
    "@loomcli/undescribed": "error",
    "@loomcli/unrooted-configuration": "warn"
  }
}
```

oxlint names a rule by the namespace of the plugin's `meta.name`, which is `@loomcli` for `@loomcli/eslint-plugin`.
### ESLint

Add the plugin's `configs.recommended` object to `eslint.config.js`. ESLint parses only JavaScript by default, so an application written in TypeScript also sets a TypeScript parser, such as the one `typescript-eslint` ships:

```js
import loom from '@loomcli/eslint-plugin';
import tseslint from 'typescript-eslint';

export default [
  { files: ['src/**/*.ts'], languageOptions: { parser: tseslint.parser } },
  { files: ['src/**/*.ts'], ...loom.configs.recommended },
];
```

typescript-eslint supports TypeScript below 6.1 and reads the TypeScript 6 API, which TypeScript 7 does not ship. An application on TypeScript 7 runs the two side by side, with `typescript` aliased to the TypeScript 6 compatibility package and the compiler installed as `@typescript/native`, which keeps `tsc` on TypeScript 7:

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

`loom init --linter eslint` writes both keys in a new scaffold, and an application that already declares `typescript` adds them by hand. The alias goes once typescript-eslint supports TypeScript 7.

`configs.recommended` registers the plugin under `@loomcli` and turns every rule on at `error`, except [`unrooted-configuration`](#unrooted-configuration), which is advice and is on at `warn`. To change a rule, set it in a later config object, such as `'@loomcli/name-shape': 'warn'`.

## How the rules find a declaration

The rules read source text and scope analysis. They use no type information. A value is a Loom declaration when it is one of these:

- `new Command(...)` or `new Application(...)`, where the binding is imported from `@loomcli/core`. A renamed import (`import { Command as Cmd }`) and a namespace import (`new core.Command(...)`) count.
- An authoring call on a Loom declaration. The authoring calls are `option`, `argument`, `globalOption`, `command`, `alias`, `action`, `stdin`, `exclusive`, `oneRequired`, `requiredTogether`, `result`, `rows`, `views`, and `extend`.
- An identifier whose `const` declaration is initialized with a Loom declaration.

Type assertions around a value (`as`, `satisfies`, `!`) do not change what it is.

A rule reports only what it can trace. Apart from what [`host-bypass`](#host-bypass) traces through a destructure, a parameter, a `let` variable, a destructured binding, a spread options object, a computed name, a name held in a variable, and a `Command` that does not come from `@loomcli/core` all get no report. A false report is worse than a missed one.

`host-bypass` judges no declaration. It reads scope analysis and import declarations, under the forms [its section](#host-bypass) lists. `strict-configuration-schema` judges the schema passed to the configuration plugin, and `unrooted-configuration` the settings passed to it, under the forms their sections list.

## Rules

### `undescribed`

Reports a declaration that has no description. Agents, MCP tools, help, and the manifest read each Command, option, and argument by its description. The rule reports these declarations:

- a `new Command(...)` or `new Application(...)` whose options leave out `description`;
- an `option(...)`, `argument(...)`, or `globalOption(...)` call whose configuration leaves out `description`;
- a `stdin(...)` call whose configuration leaves out `description`;
- an option that a `plugin(...)` definition declares as an object literal under `options`, so a plugin is linted where its source is.

```ts
import { Application } from '@loomcli/core';

// Reported: the Application, and the option, have no description.
const app = new Application('tool').option('verbose', { type: 'boolean' });
```

The rule reads an absent description and no other, as core did. A hidden or deprecated member needs one too. A configuration that is an object literal without a spread and without a `description` key, or with `description: undefined`, is reported. Any other configuration is not judged: a variable, a call, a spread, or a computed key can supply the description.

### `discarded-declaration`

Reports an authoring call on a Loom declaration whose result is discarded. A declaration is immutable, so the call builds a new declaration and changes nothing on the receiver.

```ts
const base = new Command('base', { description: 'Base.' });

// Reported: the call returns a new Command, and nothing uses it.
base.option('verbose', { description: 'Print more.', type: 'boolean' });

// Not reported: the result is assigned.
const verbose = base.option('verbose', { description: 'Print more.', type: 'boolean' });
```

A statement that begins with `void` is a deliberate discard and is not reported.

### `name-shape`

Reports a literal name that core rejects when the module loads. The rule calls the predicates `isPortableName` and `isDeclaredName`, which `@loomcli/core` exports and core's own declaration rules call. Each message ends with the correction core's diagnostic gives.

- The name of a `new Command(...)` or `new Application(...)`, and each name in an `alias(...)` call, must be a portable name: A-Z, a-z, 0-9, `.`, `_`, and `-`, nonempty, and not starting with `-` or `.`.
- The name of an `option(...)`, `argument(...)`, or `globalOption(...)` call, and each literal in an option's `aliases` array, must be a declared name: nonempty, with no leading hyphen, whitespace, or `=`.

```ts
// Reported: a space is not a portable name character.
new Command('deploy now', { description: 'Deploy.' });

// Reported: a declared name cannot start with a hyphen.
base.option('--verbose', { description: 'Print more.', type: 'boolean' });
```

The rule judges a string literal and a template literal with no substitution. It skips a name held in a variable, and it skips an `aliases` array that holds a spread or is not a literal.

### `host-bypass`

Reports code that reaches the process around the run's [host](../core/host.md). A run reads every process fact and starts every child program through its [process handle](../core/host.md#the-process-handle), which a test replaces with a [mock](testing.md#mockprocess). Code that reads the global `process`, asks `node:os` for the user's folders, or starts a child through `node:child_process` reads the machine the test runs on instead, so its result changes from one machine to the next. [ADR-0107](../decisions/0107-a-run-reads-the-process-through-one-process-handle.md) records the decision.

```ts
import { homedir } from 'node:os';

import { Command } from '@loomcli/core';

export const where = new Command('where', { description: 'Print where notes keeps its files.' }).action(
  async ({ host, out }) => {
    // Reported: homedir() reads the machine around the run. Use host.home instead.
    await out.print(homedir());
    // Reported: process.env reads the machine around the run. Use host.env instead.
    await out.print(process.env.NOTES_DIR ?? host.home);
    // Not reported: the run's host.
    await out.print(host.env.NOTES_DIR ?? host.home);
  },
);
```

Each message names what the code reached and the member to use instead:

| Reported | Use instead |
| --- | --- |
| `process.env` | `host.env` |
| `process.argv` | `host.argv` |
| `process.cwd()` | `host.cwd` |
| `process.platform`, `process.arch` | `host.platform`, `host.arch` |
| `process.getuid()` | `host.uid` |
| `process.stdin` | `host.stdin` |
| `process.stdout`, `process.stderr` | `out` |
| `process.exit()`, `process.exitCode` | a result the action returns, or a failure it throws |
| `process.on()`, `process.once()` | `onShutdown`, `onSuspend`, `onResume`, and the run's `signal` |
| any other use of `process` | the run's host |
| `homedir()` from `os` | `host.home` |
| `tmpdir()` from `os` | `host.tmpdir` |
| `userInfo()` from `os` | `host.uid` for who the user is, and `host.env.USER` for the name to show |
| `child_process` | `host.spawn` |

- **On by default.** `configs.recommended` and `configs.oxlint` turn the rule on at `error`, as they do every rule but `unrooted-configuration`.
- **The forms.** The rule reports the global `process`, `globalThis.process`, and `global.process`; an import of `process` or `node:process`, by default, namespace, or named import; `homedir`, `tmpdir`, and `userInfo` from `os` or `node:os`, as a named import or as a member of the module's default or namespace import; and any import of `child_process` or `node:child_process`. An `import()` with a literal specifier counts as an import. A re-export, `export { homedir } from 'node:os'` or `export * from 'node:child_process'`, is reported as the import it passes on, and a member destructured off an `os` binding or an awaited `import('node:os')`, as in `const { homedir } = os`, is reported as the member read it is. A type-only import or re-export, `import type` or one whose every specifier is a type, is not reported, because it runs nothing.
- **The global alone.** The rule reads scope analysis, so a binding the code declares itself, such as a parameter named `process` or a destructured `{ process }`, is not reported. A use it cannot trace, such as `Reflect.get(globalThis, 'process')` or an `import()` with a computed specifier, is not reported either.
- **The entry module.** `app.run()` given no handle binds the real process, so an entry module needs no `process` of its own and no exception.
- **Tests.** A file whose name holds `.test.` or `.spec.` is not linted by this rule. A test runs outside any run, and it is where a real folder or the machine's environment is handed to a mock, such as `tmpdir: mkdtempSync(join(tmpdir(), 'notes-'))`.

### `strict-configuration-schema`

Reports a zod strict object in the schema an application gives the [configuration plugin](../plugins/config.md). zod reports an unknown key in a strict object as an issue on the object itself, so the plugin drops the whole object, and a key an operator added for a newer version of the application would empty the section it sits in, or the whole file at the top level. `z.object`, which strips unknown keys, lets the plugin ignore them, as configuration files do. valibot and ArkType report the unknown key itself, so the plugin drops that key alone and a strict object there behaves as a loose one; the rule leaves them alone, because a false report is worse than a missed one. Standard Schema's types cannot tell a strict object from a loose one, so a lint rule carries the advice. [ADR-0118](../decisions/0118-the-configuration-plugin-reads-one-schema-described-file-through-a-provider-and-drops-what-the-schema-rejects.md) records the decision.

```ts
import { configuration } from '@loomcli/plugins/config';
import { z } from 'zod';

const updates = z.strictObject({ channel: z.string().optional() });

export const { plugin: configPlugin, values: config } = configuration({
  file: '.collector.toml',
  // Reported: z.strictObject drops the whole updates table for one unknown key. Use z.object.
  schema: z.object({ updates: updates.optional() }),
});
```

- **On by default.** `configs.recommended` and `configs.oxlint` turn the rule on at `error`, as they do every rule but `unrooted-configuration`. An author who wants a strict schema turns the rule off, and the plugin then drops what the schema reports, under the ordinary rule.
- **Where it looks.** The `schema` property of the settings object literal passed to `configuration`, where the binding is imported from `@loomcli/plugins/config`, a renamed import and a namespace import included. The rule judges that expression at every depth a strict object reaches the schema through: the arguments of a call, the schema a method is called on, the members of an object or array literal, and what the function `z.lazy` takes and a getter in an object literal return. It follows an identifier whose `const` declaration in the same module initializes it, at any depth of the expression, so a section schema declared above the call is judged.
- **The forms.** zod's `strictObject(...)`, called on a binding imported from `zod`, `zod/v4`, `zod/mini`, `zod/v4/mini`, `zod/v4-mini`, or `zod/v3`, through the whole module such as `z.strictObject(...)` included, and a `.strict()` call on a schema the rule traces to zod: a call on a zod import, a method call on one, or a `const` that holds one. The whole module is a namespace import, a default import, or the named `z` import.
- **What it leaves alone.** valibot's and ArkType's strict objects, a `.strict()` whose receiver does not trace to zod, such as yup's, which turns off coercion, a schema imported from another module, held in a `let` variable, passed through a parameter, or built by a call the rule cannot see into, and every strict object outside a `configuration` call's `schema`. A strict object that reaches the schema only as something else is left alone too: loosened by `.loose()`, `.strip()`, `.passthrough()`, or `.catchall()`, turned into the enum of its keys by `.keyof()`, the same through zod mini's `z.keyof(...)` and `z.catchall(...)`, read for a field such as `.shape` or `...State.shape`, or used inside a function that runs on the parsed value, such as a `refine` callback.
- **The message.** `A zod strict object drops its whole section from the configuration when the file holds a key it does not list. Use z.object, which strips unknown keys.`

### `unrooted-configuration`

Reports a call to the [configuration plugin](../plugins/config.md) that reads the project scope and names no root marker. The project scope walks up from the start directory, and with no marker the walk climbs past the project to the directory below home or to the filesystem root, so a file in an enclosing project, such as a monorepo's root, answers for this one. Most projects have an entry that marks their root, such as `package.json` or `.git`, but not every project has an obvious one, so the rule is advice. [ADR-0129](../decisions/0129-an-author-chooses-the-configuration-scopes-an-application-reads-and-a-root-marker-where-the-project-walk-stops.md) records the decision.

```ts
import { configuration } from '@loomcli/plugins/config';
import * as v from 'valibot';

// Reported: the walk from a package can read a file above the package.
export const { plugin: configPlugin, values: config } = configuration({
  file: '.collector.json',
  schema: v.object({ channel: v.optional(v.string()) }),
});
```

- **At `warn`.** `configs.recommended` and `configs.oxlint` turn the rule on at `warn`, the one rule they do not turn on at `error`. An author silences it for one call by naming a marker, by `root: false`, which states that the project has none, or by a `scopes` list without `'project'`.
- **Where it looks.** The settings object literal passed to `configuration`, where the binding is imported from `@loomcli/plugins/config`, a renamed import and a namespace import included. The call reads the project scope when the object has no `scopes` property or its `scopes` property is an array literal that holds the string `'project'`. The rule reports such a call when the object has no `root` property.
- **What it leaves alone.** A settings object that is not an object literal at the call, an object literal holding a spread, a `scopes` value that is not an array literal, and a `root` property of any value, `undefined` included, because a false report is worse than a missed one.
- **The message.** `This configuration reads the project scope with no root marker, so its walk climbs past the project. Name the file that marks the project's root, such as root: 'package.json', or set root: false.`

## Add a rule

A lint rule is part of Loom's public surface, so a new rule is a contract change. It is proposed and goes through the contract process. A review never adds one as a fix.
