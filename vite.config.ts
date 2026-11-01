import { defineConfig } from 'vite-plus';

// A worker that runs a process test waits on its child, so one worker per core leaves cores idle.
// Vitest caps a percentage at the core count, so the worker count is computed from this ratio.
const workersPerCore = 1.5,
  /** The message every ban of the process global names: the run's host or its handle (ADR-0107). */
  processMessage = 'Read the host of the run, or its process handle, instead (ADR-0107).',
  /** The global `process`, which only the real handle's module reads. */
  processGlobal = { message: processMessage, name: 'process' },
  /** The global `require`, which would load node:child_process around the bans below. */
  requireGlobal = {
    message: 'Import the module instead, and start a child program through host.spawn (ADR-0107).',
    name: 'require',
  },
  /** The imports of the process module. */
  processImports = [
    { message: processMessage, name: 'node:process' },
    { message: processMessage, name: 'process' },
  ],
  /** The process global read through the global object. */
  processProperties = [
    { message: processMessage, object: 'globalThis', property: 'process' },
    { message: processMessage, object: 'global', property: 'process' },
  ],
  /** What each node:os call that reads the user's folders is replaced by. */
  osReplacements = {
    homedir: 'Read host.home instead (ADR-0107).',
    tmpdir: 'Read host.tmpdir instead (ADR-0107).',
    userInfo:
      'Read host.uid for who the user is, and host.env.USER for the name to show, instead (ADR-0107).',
  },
  /** The named imports of the node:os calls, under both specifiers. */
  osImports = ['node:os', 'os'].flatMap((name) =>
    Object.entries(osReplacements).map(([member, message]) => ({
      importNames: [member],
      message,
      name,
    })),
  ),
  /** The node:os calls read off the module's default or namespace import, conventionally `os`. */
  osProperties = Object.entries(osReplacements).map(([property, message]) => ({
    message,
    object: 'os',
    property,
  })),
  /** Every import of the child-process module, and the require that would load it. */
  childMessage = 'Start the child program through host.spawn instead (ADR-0107).',
  childImports = [
    { message: childMessage, name: 'node:child_process' },
    { message: childMessage, name: 'child_process' },
    {
      importNames: ['createRequire'],
      message:
        'Import the module instead, and start a child program through host.spawn (ADR-0107).',
      name: 'node:module',
    },
  ];

export default defineConfig({
  fmt: {
    ignorePatterns: ['dist/**', '**/*.generated.ts', '**/*.{md,mdx,markdown}'],
    singleQuote: true,
    sortImports: { ignoreCase: true },
  },
  lint: {
    categories: {
      correctness: 'error',
      nursery: 'off',
      pedantic: 'off',
      perf: 'error',
      restriction: 'off',
      style: 'warn',
      suspicious: 'error',
    },
    ignorePatterns: ['dist/**', '**/*.generated.ts'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    options: {
      denyWarnings: true,
      maxWarnings: 0,
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ['packages/loom/src/**'],
        // Preserve compiler operation boundaries and Markdown/version constants.
        rules: {
          'eslint/max-params': 'off',
          'eslint/max-statements': 'off',
          'eslint/no-magic-numbers': 'off',
          'unicorn/no-null': 'off',
        },
      },
      {
        files: [
          'packages/*/src/**',
          'examples/*/src/**',
          'examples/*/scripts/**',
          'packages/*/tests/**',
          'examples/*/tests/**',
          'scripts/**',
        ],
        rules: {
          // Command contracts use named exports, Node streams, and ordered async calls.
          'eslint/func-style': ['error', 'declaration', { allowArrowFunctions: true }],
          'eslint/no-await-in-loop': 'off',
          'eslint/no-ternary': 'off',
          // The project turns one-var off on purpose, so a declaration may group or split variables.
          'eslint/one-var': 'off',
          'eslint/prefer-destructuring': 'off',
          'eslint/sort-imports': 'off',
          'import/group-exports': 'off',
          'import/no-named-export': 'off',
          'import/no-nodejs-modules': 'off',
          'import/prefer-default-export': 'off',
          'promise/avoid-new': 'off',
          'promise/prefer-await-to-callbacks': 'off',
          'promise/prefer-await-to-then': 'off',
          'typescript/method-signature-style': 'off',
        },
      },
      {
        files: [
          'packages/core/src/**',
          'packages/loom/src/**',
          'packages/plugins/src/**',
          'packages/prompts/src/**',
          'packages/testing/src/**',
          'packages/validators/src/**',
        ],
        // A run reads every process fact and makes every process effect through its process handle
        // (ADR-0107), so the code that runs inside a run never reaches the process around the handle.
        // The home, the user, and the temporary folder are host facts.
        // Every child program starts through host.spawn, so these packages never ask the machine.
        rules: {
          'eslint/no-restricted-globals': ['error', processGlobal, requireGlobal],
          'eslint/no-restricted-imports': [
            'error',
            { paths: [...processImports, ...osImports, ...childImports] },
          ],
          'eslint/no-restricted-properties': ['error', ...processProperties, ...osProperties],
        },
      },
      {
        // Core's one module that builds the real process's handle.
        // It reads the process, asks node:os for the user's folders, and starts real children.
        files: ['packages/core/src/process-handle.ts'],
        rules: {
          'eslint/no-restricted-globals': 'off',
          'eslint/no-restricted-imports': 'off',
          'eslint/no-restricted-properties': 'off',
        },
      },
      {
        // The YAML library reads its debug variables from the global, so the guard must touch it.
        files: ['packages/plugins/src/config/yaml.ts'],
        rules: {
          'eslint/no-restricted-globals': ['error', requireGlobal],
          'eslint/no-restricted-properties': ['error', ...osProperties],
        },
      },
      {
        // The toolchain's application readers are their own child programs, so each reads its process.
        // Neither imports a child-process module or asks node:os for any of the user's folders.
        files: ['packages/loom/src/read-application.ts', 'packages/loom/src/read-skills.ts'],
        rules: {
          'eslint/no-restricted-globals': ['error', requireGlobal],
          'eslint/no-restricted-imports': ['error', { paths: [...osImports, ...childImports] }],
          'eslint/no-restricted-properties': ['error', ...osProperties],
        },
      },
      {
        files: ['packages/prompts/src/**'],
        rules: {
          // Keep reader and question state transitions together; numeric values are terminal protocol offsets and viewport rows.
          'eslint/max-statements': 'off',
          'eslint/no-continue': 'off',
          'eslint/no-magic-numbers': 'off',
        },
      },
      {
        files: ['packages/core/src/**'],
        rules: {
          // Exit codes, argv offsets, and the missing-index sentinel have fixed meanings.
          // 129, 130, 131, and 143 are the cancellation codes SIGHUP, SIGINT, SIGQUIT, and SIGTERM
          // Resolve, and 141 a closed pipe's.
          // oxlint-disable-next-line eslint/no-magic-numbers
          'eslint/no-magic-numbers': ['warn', { ignore: [-1, 0, 1, 2, 129, 130, 131, 141, 143] }],
        },
      },
      {
        files: [
          'packages/core/src/application.ts',
          'packages/core/src/output.ts',
          'packages/core/src/progress-events.ts',
          'packages/core/src/region.ts',
          'packages/core/src/chain.ts',
          'packages/core/src/command.ts',
          'packages/core/src/extension.ts',
          'packages/core/src/globals.ts',
          'packages/core/src/inspect.ts',
          'packages/core/src/options.ts',
          'packages/core/src/plugin.ts',
          'packages/core/src/sources.ts',
          'packages/core/src/validation.ts',
        ],
        rules: {
          // Keep each ordered lifecycle and write-completion boundary in one method.
          // A declaration rule sequence and the `next()` lifecycle read the same way: splitting one
          // Rule out of its sequence hides which diagnostic answers first.
          // An absent spelling reports as `null`, as the inspected graph's public types state.
          'eslint/max-statements': 'off',
          'import/exports-last': 'off',
          'typescript/parameter-properties': 'off',
          'unicorn/no-null': 'off',
        },
      },
      {
        files: ['packages/core/src/errors.ts'],
        rules: {
          // Core captures its own failure classes' codes once every class is declared.
          // That capture runs below the exported classes, before any application code can run.
          'import/exports-last': 'off',
        },
      },
      {
        files: [
          'packages/loom/src/commands/build/command.ts',
          'packages/loom/src/commands/release/command.ts',
          'packages/plugins/src/background/plugin.ts',
          'packages/plugins/src/format/names.ts',
          'packages/plugins/src/manifest/document.ts',
          'packages/plugins/src/manifest/extension.ts',
          'packages/plugins/tests/manifest.test.ts',
          'packages/validators/src/**',
          'packages/validators/tests/catalog.test.ts',
        ],
        rules: {
          // The manifest document's key order is its wire contract, so its objects keep that order.
          // An input schema the document publishes keeps `type` first, then its keywords.
          'eslint/sort-keys': 'off',
        },
      },
      {
        files: ['packages/mcp/src/**'],
        rules: {
          // A message keeps the protocol's own member order, `jsonrpc` first and `_meta` last.
          // JSON-RPC answers `null` for an id it could not read, and the protocol names `_meta`.
          'eslint/no-underscore-dangle': ['error', { allow: ['_meta'] }],
          'eslint/sort-keys': 'off',
          'unicorn/no-null': 'off',
        },
      },
      {
        files: ['packages/core/src/release.ts'],
        rules: {
          // A bundler's define replaces `__LOOM_RELEASE__`, the one identifier the release facts contract names.
          'eslint/no-underscore-dangle': ['error', { allow: ['__LOOM_RELEASE__'] }],
        },
      },
      {
        files: ['packages/plugins/src/skills/carried.ts'],
        rules: {
          // A bundler's define replaces `__LOOM_SKILLS__`, the one identifier the skills folder contract names.
          'eslint/no-underscore-dangle': ['error', { allow: ['__LOOM_SKILLS__'] }],
        },
      },
      {
        files: ['packages/plugins/src/mcp/**'],
        rules: {
          // A tool, its input schema, and a text item keep the member order the protocol writes them in.
          'eslint/sort-keys': 'off',
        },
      },
      {
        files: ['packages/core/src/log.ts'],
        rules: {
          // The log contract spells a missing plugin and a missing stderr `null`, and JSON data holds `null`.
          'unicorn/no-null': 'off',
        },
      },
      {
        files: ['packages/plugins/src/verbose/plugin.ts'],
        rules: {
          // The plugin declares verbose before quiet, the order help and the manifest list them in.
          'eslint/sort-keys': 'off',
        },
      },
      {
        files: ['packages/core/src/form.ts'],
        rules: {
          // The failure form's key order is part of its contract: code, exitCode, message, hints.
          'eslint/sort-keys': 'off',
        },
      },
      {
        files: ['packages/plugins/src/manifest/document.ts'],
        rules: {
          // An absent scalar reads `null` in the document, as the contract states for every field.
          'unicorn/no-null': 'off',
        },
      },
      {
        files: [
          'packages/plugins/src/installation/record.ts',
          'packages/plugins/tests/installed-files.test.ts',
        ],
        rules: {
          // A plugin's file in the installation record keeps the member order the contract writes.
          'eslint/sort-keys': 'off',
        },
      },
      {
        files: ['packages/plugins/src/installation/**'],
        rules: {
          // A pending entry spells a file that held nothing, or will hold nothing, `null`, as the contract states.
          'unicorn/no-null': 'off',
        },
      },
      {
        files: ['packages/plugins/src/service/status.ts', 'packages/plugins/tests/service.test.ts'],
        rules: {
          // A service status keeps the member order its type lists, which its JSON view prints.
          'eslint/sort-keys': 'off',
        },
      },
      {
        files: ['packages/plugins/src/logging/directory.ts'],
        rules: {
          // A logging error with no directory to name reads `null` for its path, as the contract states.
          'unicorn/no-null': 'off',
        },
      },
      {
        files: ['packages/*/tests/**', 'examples/*/tests/**', 'scripts/**'],
        rules: {
          // Fixtures use literal expectations, stream sentinels, and callback failures.
          'eslint/max-params': 'off',
          'eslint/max-statements': 'off',
          'eslint/no-magic-numbers': 'off',
          'node/callback-return': 'off',
          'unicorn/no-null': 'off',
        },
      },
      {
        files: ['packages/*/tests/fixtures/**', 'packages/*/tests/type-consumer/**'],
        rules: {
          // These consumers exercise ignored promises, values, and rejected SDK calls.
          'eslint/no-new': 'off',
          'eslint/no-unused-expressions': 'off',
          'typescript/consistent-return': 'off',
          'typescript/no-floating-promises': 'off',
        },
      },
      {
        files: [
          '**/tests/**/*.ts',
          '**/tests/**/*.tsx',
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/*.spec.ts',
          '**/*.spec.tsx',
        ],
        // The `vitest` plugin lives here, not in the whole-project `plugins`
        // Array — so every vitest rule (matcher preferences + test-structure)
        // Applies to test files only.
        plugins: ['vitest'],
        rules: {
          // It is not-helpful to constrain the number of statements in a test
          'max-statements': 'off',

          // Nested expect matchers (objectContaining/arrayContaining trees) are
          // The idiomatic way to assert structure; extracting them into named
          // Variables obscures the asserted shape. Same author's-call policy as
          // The test-structure rules below.
          'unicorn/max-nested-calls': 'off',

          // Over-opinionated test rules relaxed in test scope — dogfooded from a
          // Real adopter. Most are test-structure style (max-expects, no-hooks,
          // Require-hook, require-top-level-describe); require-mock-type-parameters
          // Is oxlint-categorized correctness but in practice just enforces
          // Explicit mock type params, an ergonomic preference. The two prefer-*
          // Are relaxed because their "safe" autofix is behavior-/type-breaking:
          // Prefer-describe-function-title passes a non-function title,
          // Prefer-import-in-mock flips the mock overload. prefer-lowercase-title
          // And prefer-todo legislate the author's call — how a test title reads
          // And whether to write `it.todo()` — so they're off by the same policy
          // That retired the matcher-equivalence rules (ADR-0008).
          'vitest/max-expects': 'off',
          'vitest/no-hooks': 'off',
          'vitest/no-importing-vitest-globals': 'off',
          'vitest/prefer-called-exactly-once-with': 'off',
          'vitest/prefer-called-once': 'off',
          'vitest/prefer-called-times': 'off',
          'vitest/prefer-called-with': 'off',
          'vitest/prefer-describe-function-title': 'off',
          'vitest/prefer-expect-assertions': 'off',
          'vitest/prefer-import-in-mock': 'off',
          'vitest/prefer-importing-vitest-globals': 'off',
          'vitest/prefer-lowercase-title': 'off',
          'vitest/prefer-strict-boolean-matchers': 'off',
          'vitest/prefer-strict-equal': 'off',
          'vitest/prefer-to-be': 'off',
          'vitest/prefer-to-be-falsy': 'off',
          'vitest/prefer-to-be-truthy': 'off',
          'vitest/prefer-todo': 'off',
          'vitest/require-hook': 'off',
          'vitest/require-mock-type-parameters': 'off',
          'vitest/require-top-level-describe': 'off',
        },
      },
      {
        files: [
          'packages/core/src/style*.ts',
          'packages/core/src/rendering.ts',
          'packages/core/src/theme.ts',
        ],
        // ANSI codes, palette indices, framing, and tab stops are protocol constants.
        // Keep scanners and their ordered state transitions together.
        rules: {
          'eslint/max-statements': 'off',
          'eslint/no-continue': 'off',
          'eslint/no-magic-numbers': 'off',
          'eslint/no-nested-ternary': 'off',
          'typescript/consistent-indexed-object-style': 'off',
        },
      },
    ],
    plugins: ['typescript', 'import', 'eslint', 'unicorn', 'oxc', 'promise', 'node'],
    rules: {
      'eslint/no-duplicate-imports': ['warn', { allowSeparateTypeImports: true }],
      'node/no-sync': 'off',
      // The formatter writes hexadecimal digits in lowercase, which this rule would reverse.
      'unicorn/number-literal-case': 'off',
      'vite-plus/prefer-vite-plus-imports': 'error',

      // Sort keys in ascending order, but allow line-separated groups (e.g. for readability)
      'eslint/sort-keys': ['warn', 'asc', { allowLineSeparatedGroups: true }],
    },
  },
  run: {
    cache: true,
  },
  staged: {
    '*': 'vp check --fix',
  },
  test: {
    // The run fails when a test wrote under the developer's home.
    globalSetup: ['scripts/home-guard-setup.ts'],
    include: ['packages/*/tests/**/*.test.ts', 'examples/*/tests/**/*.test.ts'],
    maxWorkers: Math.ceil(navigator.hardwareConcurrency * workersPerCore),
    // A documentation-only pull request runs only the tests tagged docs, which read files under docs/.
    // A `// @module-tag docs` line in a test file tags every test in it.
    tags: [{ description: 'Reads a file under docs/', name: 'docs' }],
    // Process tests can run several children, each with its own ten-second deadline.
    testTimeout: 30_000,
  },
});
