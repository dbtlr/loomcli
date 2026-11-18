import type { InputProblem } from '../failures/errors.js';

/** Raw inputs stay outside failures, whose ordinary views and encoders must never expose them. */
const values = new WeakMap<InputProblem, unknown>();

function rememberReceived(problem: InputProblem, value: unknown): void {
  values.set(problem, value);
}

function received(problem: InputProblem): unknown {
  return problem.reason === 'invalid' ? values.get(problem) : undefined;
}

export { received, rememberReceived };
