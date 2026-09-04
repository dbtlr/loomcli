import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    ignore: ['dist/**', '**/*.generated.ts', '**/*.{md,mdx,markdown}'],
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
        files: [
          'tests/**/*.ts',
          'tests/**/*.tsx',
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
      // We're explicitly using synchronous fs methods in some places, like validation
      // Rules, where we want to avoid async calls
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
    passWithNoTests: true,
  },
});
