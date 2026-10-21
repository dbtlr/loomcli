---
description: "loom init: the scaffold files, the managed files, and drift warnings."
---

# loom init

```text
loom init [--only <piece>]... [--linter oxlint|eslint] [--test-runner bun|vitest] [--force]
```

```sh
mkdir notes && cd notes
bunx @loomcli/loom init   # a new application: package.json, src/, its test, the lint configuration, tsconfig.json, .changes/README.md, and the skill
pnpm install
pnpm check
```

In an empty directory nothing is installed yet, so the first run goes through the package runner. Inside a package that already depends on `@loomcli/loom`, the bin is `loom`, as the rest of this page writes it.

`loom init` scaffolds a new application in an empty directory, or adds the pieces an existing package lacks. It writes two sorts of files: scaffold files, which become the author's at once, and managed files, which init keeps current.

- **Where.** In an empty working directory, init scaffolds a new application there, whatever lies above it. Otherwise it acts on the package directory. A directory that is neither empty nor inside a package fails with exit 1.
- **The pieces.** `application` is `src/application.ts`, `entry` is `src/main.ts`, `tsconfig` is `tsconfig.json`, `test` is `src/application.test.ts`, `lint` is the linter's configuration file, `package` is the `package.json` keys, `changes` is `.changes/README.md`, `skill` is the changelog skill, and `install` is the [installer script](install.md), `install.sh`. `--only <piece>` limits init to the pieces it names, and it may repeat.
- **Output.** Init prints one line for each file or key it writes and each warning it raises, and it installs nothing. The author runs the package manager afterward.
- **Later pieces.** A release-cut skill and release workflows are not pieces, because release orchestration stays with each repository.

## Scaffold files

- **The files.** `src/application.ts` exports an Application named with the application's name, with a description and one described action, so a new scaffold passes its own `check` script. `src/main.ts` imports it and calls `run()`, and it opens with `#!/usr/bin/env node`, which the bundle keeps. `tsconfig.json` is a strict configuration for a Node ESM application that emits nothing, because `loom build` bundles it, so `tsc --noEmit` checks it. `src/application.test.ts` imports the Application from `./application.js` and passes it to the `@loomcli/testing` assembly check in one test, under `bun:test` or vitest. A comment above the test says to keep it, because it is the check that the whole application assembles, so a fault only the assembled application reveals fails CI rather than the operator's first run. A Bun test opens with `/// <reference types="bun" />`, because TypeScript loads no `@types` package that a configuration does not list. The lint file is `.oxlintrc.json` for oxlint, which holds the `configs.oxlint` object of [`@loomcli/eslint-plugin`](../libs/eslint-plugin.md) as it is, or `eslint.config.js` for ESLint, which sets the TypeScript parser from `typescript-eslint` and adds the plugin's `configs.recommended`, under [ADR-0098](../decisions/0098-lint-is-the-author-guidance-lane.md).
- **The linter and the test runner.** `--linter oxlint|eslint` and `--test-runner bun|vitest` choose what the lint file, the test, the `check` script, and the development dependencies serve, by default oxlint and Bun. A package that settles a choice keeps it without a question. An `.oxlintrc.json`, `.oxlintrc.jsonc`, `oxlint.config.ts`, or `oxlint.config.mts` selects oxlint, and init writes no second oxlint file beside one, because oxlint refuses to run when a directory holds two. An `eslint.config.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, or `.cts` selects ESLint. A package that declares `vitest` in any dependency field selects vitest, and one that declares `@types/bun` selects Bun. When both lint configurations exist, oxlint wins, and when both runners are declared, vitest wins. A flag the operator supplies wins over what the package holds.
- **TypeScript for ESLint.** typescript-eslint supports TypeScript below 6.1 and reads the TypeScript 6 API, which TypeScript 7 does not ship, so an ESLint scaffold runs TypeScript 6 and 7 side by side. `devDependencies.typescript` is `npm:@typescript/typescript6@<range>`, the TypeScript 6 compatibility package, which typescript-eslint loads, and `devDependencies.@typescript/native` is `npm:typescript@<the compiler range>`, which supplies the `tsc` bin, so `tsc --noEmit` stays on TypeScript 7. An oxlint scaffold keeps the plain `typescript` key. Init never overwrites a key, so a package that already declares `typescript` keeps it and gains no `@typescript/native`; an existing ESLint package on TypeScript 7 adds the alias by hand. Init warns about it: when the linter is ESLint and the package declares `typescript` as anything but the alias, init prints one warning that names the alias and the `@typescript/native` key and links the [plugin reference](../libs/eslint-plugin.md#eslint), because `eslint .` fails there. Both keys go once typescript-eslint supports TypeScript 7.
- **The questions.** Each choice is a `select` question from [`@loomcli/prompts`](../libs/prompts.md) linked to its option with `skipIfSupplied`, so a supplied flag skips it. Init asks only when the answer changes something it will write, which is the lint file or the `check` script and its dependencies for the linter, and the test or the `check` script and its dependencies for the runner, and only when no existing configuration or dependency already decides it and the run is interactive. A re-run of a scaffold therefore asks nothing. Off a terminal, or under `--no-input`, the declared default applies and nothing is asked.
- **The `package.json` keys.** `bin` maps the application's name to `dist/main.js`. `scripts` gains `build`, `loom build --target node`, and `check`, which runs `tsc --noEmit && <linter> && <test runner>`: `oxlint src` or `eslint .`, then `bun test` or `vitest run`. oxlint lints `src` alone, because it ignores `node_modules` only where a `.gitignore` names it, which a new scaffold does not yet have. `dependencies` gains `@loomcli/core`, and `devDependencies` gains `@loomcli/loom`, `@loomcli/testing`, and `@loomcli/eslint-plugin`, each at the exact version of the running `loom`. `devDependencies` also gains `typescript`, at the compiler range `@loomcli/loom` declares as its optional peer dependency, and the packages of the chosen tools: `oxlint`, or `eslint` and `typescript-eslint`; and `@types/bun` or `vitest`. Init holds the range of each tool package in one place and bumps it by hand. A dependency the package already declares in any of `dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies` is left where it is and not added again. In an empty directory, init first writes a `package.json` whose `name` is the directory's name, `version` is `0.0.0`, and `type` is `module`.
- **The application's name.** It is the `bin` key when `bin` is an object with one key, else the package name without its scope.
- **Written once.** Init writes a scaffold file or key only when it is missing. It never overwrites an existing file or key and never tracks one afterward, because each is the author's code from the moment it is written.

## Managed files

```markdown
<!-- Managed by loom init. sha256:923fbdf28841b97b237ceaed44c491528c9e1776959c0e8f40ee87488b415571 -->

# Change fragments
```

- **The files.** `.changes/README.md` is the fragment guide, covering the three kinds. The changelog skill teaches an agent to keep the package's changelog and is written to `.agents/skills/loom-changelog/SKILL.md` in the package directory. `install.sh` is the [installer script](install.md), written only when the package names a GitHub repository.
- **The header.** Each managed file carries a header that holds a checksum of the file's content without the header: a Markdown comment on the first line, or, in a skill, on the first non-blank line after its frontmatter, and in `install.sh` a `#` comment on the line after its `#!` line.
- **Re-running init.** Init re-renders a managed file whose checksum matches, so an unedited file follows the running toolchain. A file whose content no longer matches its checksum has drifted. Init warns about it and leaves it alone, and `--force` re-renders it. `--force` never touches a scaffold file.
- **Leaving management.** Deleting the header releases a file from management. Init then treats it as the author's file and never writes it again, and never warns about it.
- **Drift is a warning.** `loom init` warns about a drifted managed file and never fails for one. No other command checks managed files.

## loom init acceptance

`loom init` is proven when process runs of the packed `loom` bin produce these results under Node and Bun:

- **A new application.** In an empty directory, init writes `package.json`, the scaffold files, the fragment guide, and the skill, and prints the warning that `install.sh` was not written, because the new `package.json` names no repository. After the package manager installs, `tsc --noEmit` and the assembly test pass, `loom build --target node` builds, and the bundle runs under Node and Bun. The packed run installs the scaffold from the packed tarballs for the defaults and for `--linter eslint --test-runner vitest`, requires `tsc` to report TypeScript 7, requires `bun run check` to exit 0, and requires each linter run to name `@loomcli/undescribed` once an option lacks a description.
- **An existing package.** In a package with its own `src/application.ts`, `scripts.build`, `tsconfig.json`, and `devDependencies.typescript`, init writes the missing pieces and leaves all four byte-identical. `--only changes` writes `.changes/README.md` alone, and `--only tsconfig` writes `tsconfig.json` alone.
- **Managed files.** Re-running init on an unedited managed file re-renders it. An edited one draws one warning and stays byte-identical, and `--force` re-renders it. A file whose header was deleted stays byte-identical under `--force` and draws no warning.
- **The installer script.** In a package whose `repository` reads as `me/notes`, init writes `install.sh` with the shell header, the application's name, and `me/notes`, and the file is executable. After `repository` changes to `me/jot`, init re-renders an unedited script with `me/jot`. An edited script draws the drift warning from init. `--only install` writes the script alone. With no `repository`, and with a `repository` on another host such as `gitlab:me/notes`, init writes no `install.sh`, prints the warning that names `repository`, and exits 0.
