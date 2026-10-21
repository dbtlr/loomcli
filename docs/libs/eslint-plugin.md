---
description: The @loomcli/eslint-plugin reference. The lint rules that guide an application author where a type cannot, how to load them in oxlint and ESLint, how the rules find a declaration, and what each rule reports and leaves alone.
---

# ESLint plugin reference

`@loomcli/eslint-plugin` ships the [lint rules](../glossary.md) for Loom applications. A lint rule guides an author where a type cannot express the guidance, and it reports in the editor and in CI before anything runs. [ADR-0098](../decisions/0098-lint-is-the-author-guidance-lane.md) records the decision. The plugin is ESLint-compatible, so oxlint loads it through its `jsPlugins` setting and ESLint loads it as a flat-config plugin. Both tools run the same three rules.

The package is private until the release that ships it, planned for 0.15.0. It has a peer dependency on `@loomcli/core`, because the `name-shape` rule calls the same name predicates core does. It needs no type information, so it runs under oxlint, which provides none.

## Install and configure

Install the plugin as a development dependency of the application, beside `@loomcli/core`:

```sh
npm install --save-dev @loomcli/eslint-plugin
```

### oxlint

Put the plugin's `configs.oxlint` object in `.oxlintrc.json`, as it is:

```json
{
  "jsPlugins": ["@loomcli/eslint-plugin"],
  "rules": {
    "@loomcli/discarded-declaration": "error",
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

`configs.recommended` registers the plugin under `@loomcli` and turns all three rules on at `error`. To change a rule, set it in a later config object, such as `'@loomcli/name-shape': 'warn'`.

## How the rules find a declaration

The rules read source text and scope analysis. They use no type information. A value is a Loom declaration when it is one of these:

- `new Command(...)` or `new Application(...)`, where the binding is imported from `@loomcli/core`. A renamed import (`import { Command as Cmd }`) and a namespace import (`new core.Command(...)`) count.
- An authoring call on a Loom declaration. The authoring calls are `option`, `argument`, `globalOption`, `command`, `alias`, `action`, `stdin`, `exclusive`, `oneRequired`, `requiredTogether`, `result`, `rows`, `views`, and `extend`.
- An identifier whose `const` declaration is initialized with a Loom declaration.

Type assertions around a value (`as`, `satisfies`, `!`) do not change what it is.

A rule reports only what it can trace. A parameter, a `let` variable, a destructured binding, a spread options object, a computed name, a name held in a variable, and a `Command` that does not come from `@loomcli/core` all get no report. A false report is worse than a missed one.

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

## Add a rule

A lint rule is part of Loom's public surface, so a new rule is a contract change. It is proposed and goes through the contract process. A review never adds one as a fix.
