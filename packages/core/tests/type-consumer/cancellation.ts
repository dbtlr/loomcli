import { Application, plugin } from '@loomcli/core';
import type { ExitCode, Plugin } from '@loomcli/core';

const cancellable = new Application('cancellable').action(({ signal }) => signal.aborted);

// A caller-owned signal cancels the run, and `run()` still resolves an `ExitCode`.
const controller = new AbortController();
const resolved: Promise<ExitCode> = cancellable.run({ signal: controller.signal });

// A plugin owns the signals slot by claiming both members of the closed set.
function signals(): Plugin {
  return plugin('@consumer/signals', { signals: ['SIGINT', 'SIGTERM'] });
}

// @ts-expect-error TS2322: SIGHUP is outside the closed set the signals slot accepts.
const hangup = plugin('@consumer/hangup', { signals: ['SIGHUP'] });

// Every member of the widened `ExitCode`, so a further member would fail to compile here.
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
    case 130: {
      return 'cancelled';
    }
    case 143: {
      return 'terminated';
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

void resolved;
void hangup;

export { describe, signals };
