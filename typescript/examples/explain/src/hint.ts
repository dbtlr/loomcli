import { UnknownOptionError } from '@loomcli/core';
import type { FailureHook } from '@loomcli/core';

/**
 * Points an operator who typed an unknown option at the explanation of the Command they reached.
 * The command line is the application name, the routed path, and `--explain`, which are declared
 * names, so the hint interpolates nothing the operator typed. Every other failure gets no hint, and
 * so does an invocation by name, where no command line exists to rerun.
 */
export const explainHint: FailureHook = (failure, { application, invokedBy, path }) =>
  failure instanceof UnknownOptionError && invokedBy === 'argv'
    ? `Run "${[application, ...path, '--explain'].join(' ')}" to explain this command.`
    : undefined;
