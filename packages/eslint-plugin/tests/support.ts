import tsParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vite-plus/test';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/**
 * A tester that parses TypeScript, because an application is written in it. The parser reads the
 * source text alone, so no case needs a project or type information, as under oxlint.
 */
export const tester = new RuleTester({
  languageOptions: { parser: tsParser, sourceType: 'module' },
});

/** The import every case that builds a declaration opens with. */
export const coreImport = "import { Application, Command } from '@loomcli/core';";
