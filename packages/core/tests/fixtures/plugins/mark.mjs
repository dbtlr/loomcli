import { appendFileSync } from 'node:fs';

/**
 * Records that a module was evaluated, so a test can show which plugin implementations one
 * invocation loaded. The path arrives in the environment, so nothing is written without one.
 */
export function mark(text) {
  const path = process.env.LOOM_FIXTURE_MARKS;
  if (path) {
    appendFileSync(path, `${text}\n`);
  }
}
