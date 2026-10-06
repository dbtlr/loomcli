import { Application, Command } from '@loomcli/core';
import type {
  FailureExitCode,
  InvocationOutcome,
  InvocationValues,
  InvokeOptions,
  LoomError,
  Middleware,
  Plugin,
} from '@loomcli/core';

const get = new Command('get').argument('path', { required: true }).action(() => undefined);
const app = new Application('probe').command(get);

// With no handler, the outcome's failure is the failure itself.
const plain: Promise<InvocationOutcome> = app.invoke(['get'], { args: { path: 'name' } });

// The outcome narrows on `status`, and `Mapped` is inferred from the handler.
async function mapped(): Promise<string> {
  const outcome = await app.invoke(
    ['get'],
    { args: { path: 'name' }, options: { verbose: 2 } },
    { failure: (failure, { exitCode }) => ({ code: exitCode, message: failure.message }) },
  );
  switch (outcome.status) {
    case 'completed': {
      return outcome.output;
    }
    case 'failed': {
      const code: FailureExitCode = outcome.failure.code;
      const message: string = outcome.failure.message;
      return `${String(code)} ${message} ${outcome.messages}`;
    }
    case 'cancelled': {
      const code: 130 | 143 = outcome.exitCode;
      // @ts-expect-error TS2339: A cancelled outcome carries no captured text.
      void outcome.output;
      return String(code);
    }
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

// Every value of the union lowers: a string, a number, a Boolean, a list, and an absent key.
const values: InvocationValues = {
  args: { files: ['a', 1], path: 'x' },
  options: { count: 3, flag: true, name: undefined, ratio: 0.5 },
  passthrough: ['--', 'raw'],
};

// @ts-expect-error TS2322: null is outside the value union.
const nullish: InvocationValues = { options: { name: null } };

// @ts-expect-error TS2353: An object is outside the value union.
const nested: InvocationValues = { args: { path: { deep: 'x' } } };

// The four host fields are whole replacements on `app.invoke`.
const hosted = app.invoke([], {}, { host: { cwd: '/virtual', env: {}, platform: 'linux' } });

// @ts-expect-error TS2353: A host field outside the four is rejected.
const argv = app.invoke([], {}, { host: { argv: ['get'] } });

// An action runs another Command of its own graph, and its call takes no host.
const caller = new Command('caller').action(async ({ invoke }) => {
  const outcome = await invoke(['get'], { args: { path: 'name' } }, { view: 'json' });
  const failure: LoomError | undefined = outcome.status === 'failed' ? outcome.failure : undefined;
  // @ts-expect-error TS2353: An action's call reads its run's host fields, so it takes no host.
  await invoke([], {}, { host: { cwd: '/' } });
  return failure;
});

// The options type is exported, with the failure handler typed by what it returns.
const options: InvokeOptions<number> = { failure: () => 1, signal: new AbortController().signal };

// A middleware's context carries no `invoke`.
const middleware: Middleware<Plugin> = async (context) => {
  // @ts-expect-error TS2339: A middleware wraps one invocation and runs no other.
  void context.invoke;
  await context.next();
};

void plain;
void mapped;
void values;
void nullish;
void nested;
void hosted;
void argv;
void caller;
void options;
void middleware;
