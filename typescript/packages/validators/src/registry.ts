/*
 * The validators package's member of `MessagePackages`, so a phrasebook for `@loomcli/validators`
 * checks each sentence by name and parameters. The package entry imports this file, so every
 * program that imports `@loomcli/validators` sees the member.
 */
import type * as common from './messages.js';

/**
 * The validators package's message modules, by the name of the concept module that holds each
 * one. Each member is the module's own type, so the declaration loads nothing at run time.
 *
 * @public
 * @sealed
 */
interface ValidatorMessageModules {
  /** The issues of every validator the package ships. */
  readonly common: typeof common;
}

declare module '@loomcli/core' {
  interface MessagePackages {
    /** The validators package's message modules. */
    readonly '@loomcli/validators': ValidatorMessageModules;
  }
}

export type { ValidatorMessageModules };
