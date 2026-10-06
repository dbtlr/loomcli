import { UsageError } from '@loomcli/core';
import type { FailureHook } from '@loomcli/core';

/**
 * Points every usage error at the extended help page of the Command routing reached, which states
 * the usage and each input's accepted values. The command line is the application name and the
 * routed canonical names, so the hint repeats nothing the operator typed. Every other failure gets
 * no hint, and so does an invocation by name, where no command line exists to rerun.
 */
export const helpHint: FailureHook = (failure, { application, invokedBy, path }) =>
  failure instanceof UsageError && invokedBy === 'argv'
    ? `Run "${[application, ...path, '--help'].join(' ')}" to see the usage.`
    : undefined;
