/*
 * The plugin pack's member of `MessagePackages`: each of its message modules by the name of the
 * concept module that holds it, and `common` for the sentences several plugins share. The voice
 * test checks this list against the `messages.ts` files under `src`, so no sentence falls outside
 * a phrasebook's type. Every subpath entry re-exports nothing from this module, so its declarations
 * load the member for an author who writes `phrasebook('@loomcli/plugins', …)`.
 */
import type * as background from './background/messages.js';
import type * as completion from './completion/messages.js';
import type * as config from './config/messages.js';
import type * as dotenv from './dotenv/messages.js';
import type * as externalCommands from './external-commands/messages.js';
import type * as format from './format/messages.js';
import type * as help from './help/messages.js';
import type * as installation from './installation/messages.js';
import type * as logging from './logging/messages.js';
import type * as manpage from './manpage/messages.js';
import type * as mcp from './mcp/messages.js';
import type * as common from './messages.js';
import type * as selfUpdate from './self-update/messages.js';
import type * as service from './service/messages.js';
import type * as skills from './skills/messages.js';
import type * as suggestions from './suggestions/messages.js';
import type * as version from './version/messages.js';

/**
 * The plugin pack's message modules, by the name of the concept module that holds each one. Each
 * member is the module's own type, so the declaration loads nothing at run time.
 *
 * @public
 * @sealed
 */
interface PluginMessageModules {
  /** The issue of a background job's setting. */
  readonly background: typeof background;
  /** The sentences of the completion plugin's scripts, installs, and refreshes. */
  readonly completion: typeof completion;
  /** The sentences, issues, and lines of the configuration plugin. */
  readonly config: typeof config;
  /** The lines and warnings of the dotenv plugin. */
  readonly dotenv: typeof dotenv;
  /** The sentences of the external-commands plugin. */
  readonly 'external-commands': typeof externalCommands;
  /** The sentences and issues of the format plugin. */
  readonly format: typeof format;
  /** The help plugin's hint and the labels of its help page. */
  readonly help: typeof help;
  /** The sentences of the installed-files module that the install plugins share. */
  readonly installation: typeof installation;
  /** The sentences of the logging plugin. */
  readonly logging: typeof logging;
  /** The sentences of the man page plugin's installs and refreshes. */
  readonly manpage: typeof manpage;
  /** The sentences of the MCP plugin's server and registrations. */
  readonly mcp: typeof mcp;
  /** The sentences several plugins share. */
  readonly common: typeof common;
  /** The sentences of the self-update plugin. */
  readonly 'self-update': typeof selfUpdate;
  /** The sentences of the service plugin. */
  readonly service: typeof service;
  /** The sentences of the skills plugin's installs and refreshes. */
  readonly skills: typeof skills;
  /** The fixes the suggestions plugin offers. */
  readonly suggestions: typeof suggestions;
  /** The labels of the version plugin's extended block. */
  readonly version: typeof version;
}

declare module '@loomcli/core' {
  /** The plugin pack's member, merged into core's registry of message packages. */
  interface MessagePackages {
    /** The plugin pack's message modules. */
    readonly '@loomcli/plugins': PluginMessageModules;
  }
}

export type { PluginMessageModules };
