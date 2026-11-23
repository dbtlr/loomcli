import { fileURLToPath } from 'node:url';

import { drive } from '../../../scripts/test-terminal.js';

/** Drives one scenario of the prompts fixture on a real terminal. */
export function terminal(
  scenario: string,
  env: Record<string, string> = {},
  options: { pipeStdout?: boolean } = {},
) {
  return drive(
    [
      ...(options.pipeStdout ? ['zsh', '-c', '"$@" | tee "$PROMPT_STDOUT"', 'loom-prompt'] : []),
      process.env.LOOM_TEST_RUNTIME ?? 'node',
      fileURLToPath(new URL('fixtures/terminal.mjs', import.meta.url)),
      scenario,
    ],
    env,
  );
}
