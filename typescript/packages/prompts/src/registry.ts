/*
 * The prompts package's member of `MessagePackages`, so a phrasebook for `@loomcli/prompts`
 * checks each sentence by name and parameters. The package entry imports this file, so every
 * program that imports `@loomcli/prompts` sees the member.
 */
// The registry describes the message module as a whole.
// oxlint-disable-next-line import/no-namespace
import type * as common from './messages.js';

/**
 * The prompts package's message modules, by the name of the concept module that holds each one.
 * Each member is the module's own type, so the declaration loads nothing at run time.
 *
 * @public
 * @sealed
 */
interface PromptMessageModules {
  /** The sentences and issues of the prompts and their views. */
  readonly common: typeof common;
}

declare module '@loomcli/core' {
  interface MessagePackages {
    /** The prompts package's message modules. */
    readonly '@loomcli/prompts': PromptMessageModules;
  }
}

export type { PromptMessageModules };
