import { defineConfig } from 'vite-plus';

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
        files: ['apps/loom/src/**'],
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
          'packages/core/src/**',
          'examples/*/src/**',
          'apps/*/src/**',
          'packages/*/tests/**',
          'examples/*/tests/**',
          'apps/*/tests/**',
          'scripts/**',
        ],
        rules: {
          // Command contracts use named exports, Node streams, and ordered async calls.
          'eslint/func-style': ['error', 'declaration', { allowArrowFunctions: true }],
          'eslint/no-await-in-loop': 'off',
          'eslint/no-ternary': 'off',
          'eslint/one-var': ['error', 'never'],
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
        files: ['packages/core/src/**'],
        rules: {
          // Exit codes, argv offsets, and the missing-index sentinel have fixed meanings.
          // oxlint-disable-next-line eslint/no-magic-numbers
          'eslint/no-magic-numbers': ['warn', { ignore: [-1, 0, 1, 2] }],
        },
      },
      {
        files: [
          'packages/core/src/application.ts',
          'packages/core/src/output.ts',
          'packages/core/src/chain.ts',
          'packages/core/src/command.ts',
          'packages/core/src/extension.ts',
          'packages/core/src/globals.ts',
          'packages/core/src/inspect.ts',
          'packages/core/src/options.ts',
          'packages/core/src/plugin.ts',
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
        files: ['packages/*/tests/**', 'examples/*/tests/**', 'apps/*/tests/**', 'scripts/**'],
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
        files: [
          'packages/*/tests/fixtures/**',
          'packages/*/tests/type-consumer/**',
          'examples/*/tests/fixtures/**',
        ],
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
    ],
    plugins: ['typescript', 'import', 'eslint', 'unicorn', 'oxc', 'promise', 'node'],
    rules: {
      'eslint/no-duplicate-imports': ['warn', { allowSeparateTypeImports: true }],
      'node/no-sync': 'off',
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
    include: [
      'packages/*/tests/**/*.test.ts',
      'examples/*/tests/**/*.test.ts',
      'apps/*/tests/**/*.test.ts',
    ],
    // Process tests can run several children, each with its own ten-second deadline.
    testTimeout: 30_000,
  },
});
