# @loomcli/eslint-plugin

Lint rules for a Loom application. They guide an author where a type cannot, such as an authoring call whose new declaration is discarded, or a read of the process that bypasses the run's host, and they report in the editor and in CI before anything runs. The plugin is ESLint-compatible, so oxlint loads it through `jsPlugins` and ESLint loads it as a flat-config plugin, and both run the same rules.

`@loomcli/core` is a peer dependency.

## Install

```sh
pnpm add -D @loomcli/eslint-plugin
```

## Use

With oxlint, in `.oxlintrc.json`:

```json
{
  "jsPlugins": ["@loomcli/eslint-plugin"],
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

With ESLint, in `eslint.config.js`, beside a TypeScript parser:

```js
import loom from '@loomcli/eslint-plugin';
import tseslint from 'typescript-eslint';

export default [
  { files: ['src/**/*.ts'], languageOptions: { parser: tseslint.parser } },
  { files: ['src/**/*.ts'], ...loom.configs.recommended },
];
```

## Documentation

The [ESLint plugin reference](https://github.com/dbtlr/loomcli/blob/main/docs/libs/eslint-plugin.md) documents each rule, and the [documentation map](https://github.com/dbtlr/loomcli/blob/main/docs/README.md) covers the rest of Loom.
