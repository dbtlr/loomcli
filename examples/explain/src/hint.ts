import { UnknownOptionError } from '@loomcli/core';
import type { FailureHook } from '@loomcli/core';

/**
 * Points an operator who typed an unknown option at the explanation of the Command they reached.
 * The command line is the application name, the routed path, and `--explain`, which are declared
 * names, so the hint interpolates nothing the operator typed. Every other failure gets no hint.
 */
export const explainHint: FailureHook = (failure, { application, path }) =>
  failure instanceof UnknownOptionError
    ? `Run "${[application, ...path, '--explain'].join(' ')}" to explain this command.`
    : undefined;
