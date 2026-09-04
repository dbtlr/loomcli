import { defineConfig, toolingPlugin } from '@dbtlr/tooling';

export default defineConfig({
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
  },

  plugins: [
    toolingPlugin({
      fmt: {
        // machine-written (scripts/generate-ui-assets.ts) and gitignored
        ignores: ['**/*.generated.ts'],
      },
      lint: {
        ignores: ['dist/**', '**/*.generated.ts'],
        rules: {
          // we're explicitly using synchronous fs methods in some places, like validation
          // rules, where we want to avoid async calls
          'node/no-sync': 'off',
          'vite-plus/prefer-vite-plus-imports': 'error',
        },
      },
      react: false,
    }),
  ],

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
