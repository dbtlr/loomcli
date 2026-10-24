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
    "@loomcli/undescribed": "error"
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

`configs.recommended` registers the plugin under `@loomcli` and turns every rule on at `error`. To change a rule, set it in a later config object, such as `'@loomcli/name-shape': 'warn'`.

## How the rules find a declaration

The rules read source text and scope analysis. They use no type information. A value is a Loom declaration when it is one of these:

- `new Command(...)` or `new Application(...)`, where the binding is imported from `@loomcli/core`. A renamed import (`import { Command as Cmd }`) and a namespace import (`new core.Command(...)`) count.
- An authoring call on a Loom declaration. The authoring calls are `option`, `argument`, `globalOption`, `command`, `alias`, `action`, `stdin`, `exclusive`, `oneRequired`, `requiredTogether`, `result`, `rows`, `views`, and `extend`.
- An identifier whose `const` declaration is initialized with a Loom declaration.

Type assertions around a value (`as`, `satisfies`, `!`) do not change what it is.

A rule reports only what it can trace. A parameter, a `let` variable, a destructured binding, a spread options object, a computed name, a name held in a variable, and a `Command` that does not come from `@loomcli/core` all get no report. A false report is worse than a missed one.

`host-bypass` judges no declaration. It reads scope analysis and import declarations, under the forms [its section](#host-bypass) lists.

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
| `process.on()`, `process.once()` | `onShutdown`, and the run's `signal` |
| any other use of `process` | the run's host |
| `homedir()` from `os` | `host.home` |
| `tmpdir()` from `os` | `host.tmpdir` |
| `userInfo()` from `os` | `host.uid` for who the user is, and `host.env.USER` for the name to show |
| `child_process` | `host.spawn` |

- **On by default.** `configs.recommended` and `configs.oxlint` turn the rule on at `error`, as they do every rule.
- **The forms.** The rule reports the global `process`, `globalThis.process`, and `global.process`; an import of `process` or `node:process`, by default, namespace, or named import; `homedir`, `tmpdir`, and `userInfo` from `os` or `node:os`, as a named import or as a member of the module's default or namespace import; and any import of `child_process` or `node:child_process`. An `import()` with a literal specifier counts as an import.
- **The global alone.** The rule reads scope analysis, so a binding the code declares itself, such as a parameter named `process` or a destructured `{ process }`, is not reported. A use it cannot trace, such as `Reflect.get(globalThis, 'process')` or an `import()` with a computed specifier, is not reported either.
- **The entry module.** `app.run()` given no handle binds the real process, so an entry module needs no `process` of its own and no exception.
- **Tests.** A file whose name holds `.test.` or `.spec.` is not linted by this rule. A test runs outside any run, and it is where a real folder or the machine's environment is handed to a mock, such as `tmpdir: mkdtempSync(join(tmpdir(), 'notes-'))`.

## Add a rule

A lint rule is part of Loom's public surface, so a new rule is a contract change. It is proposed and goes through the contract process. A review never adds one as a fix.
