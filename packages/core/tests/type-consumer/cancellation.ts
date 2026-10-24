import { Application, onResume, onShutdown, onSuspend, plugin } from '@loomcli/core';
import type {
  CancellationReason,
  ExitCode,
  FailureExitCode,
  Middleware,
  Plugin,
  OnShutdown,
  ShutdownEvent,
  Synchronous,
} from '@loomcli/core';

const cancellable = new Application('cancellable').action(({ signal }) => signal.aborted);

// The reason core owns is published, so a middleware reads `source` under a type of its own.
const source: CancellationReason['source'] = 'SIGTERM';
const hungUp: CancellationReason['source'] = 'SIGHUP';
const quit: CancellationReason['source'] = 'SIGQUIT';
const closed: CancellationReason['source'] = 'closed-pipe';

// A caller-owned signal cancels the run, and `run()` still resolves an `ExitCode`.
const controller = new AbortController();
const resolved: Promise<ExitCode> = cancellable.run({ signal: controller.signal });

// @ts-expect-error TS2353: A plugin claims no signals; every ending signal starts the shutdown.
const claiming = plugin('@consumer/signals', { signals: ['SIGINT', 'SIGTERM'] });

// The shutdown budget is the Application's own option.
const daemon = new Application('daemon', { shutdown: { timeout: 2000 } });

// A handler is synchronous: it receives the cause and the status, and returns no promise.
const removeProcessHandler: () => void = onShutdown((event: ShutdownEvent) => {
  const cause: 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGTERM' | 'exit' = event.cause;
  const code: number = event.code;
  void cause;
  void code;
});

// @ts-expect-error TS2322: A handler that returns a promise does not compile.
onShutdown(async () => undefined);

// @ts-expect-error TS2322: A handler that returns a thenable does not compile either.
onShutdown(() => Promise.resolve(1));

// A handler may return a value, which core ignores.
onShutdown(() => 'restored');

const removeSuspend: () => void = onSuspend(() => undefined);
const removeResume: () => void = onResume(() => undefined);

// @ts-expect-error TS2322: A suspend handler is synchronous too.
onSuspend(async () => undefined);

// The action and middleware contexts carry the run-scoped registration.
const scoped = new Application('scoped').action(({ onShutdown: register }) => {
  const own: OnShutdown = register;
  const remove: () => void = register(() => undefined);
  // @ts-expect-error TS2322: A run-scoped handler is synchronous by type.
  register(async () => undefined);
  void own;
  remove();
});

const middleware: Middleware<Plugin> = async ({ next, onShutdown: register }) => {
  const remove = register(() => undefined);
  await next();
  remove();
};

// `Synchronous` maps a promise to never, and leaves every other value as it is.
const value: Synchronous<string> = 'kept';
// @ts-expect-error TS2322: No value satisfies a synchronous promise.
const never: Synchronous<Promise<void>> = Promise.resolve();

// Every member of the widened `ExitCode`: core's codes by name, and the range a class declares.
// A further member outside the declarable range would fail to compile here.
function describe(status: ExitCode): string {
  switch (status) {
    case 0: {
      return 'succeeded';
    }
    case 1: {
      return 'failed';
    }
    case 2: {
      return 'invalid input';
    }
    case 129: {
      return 'hung up';
    }
    case 130: {
      return 'cancelled';
    }
    case 131: {
      return 'quit';
    }
    case 141: {
      return 'closed pipe';
    }
    case 143: {
      return 'terminated';
    }
    default: {
      const declared: FailureExitCode = status;
      return `declared ${String(declared)}`;
    }
  }
}

void resolved;
void claiming;
void daemon;
void removeProcessHandler;
void removeSuspend;
void removeResume;
void scoped;
void middleware;
void value;
void never;
void source;
void hungUp;
void quit;
void closed;

export { describe };
