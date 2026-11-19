import { pluginSites } from '../commands/globals.js';
import { slotSite } from '../diagnostics/facts.js';
import type { FactSite } from '../diagnostics/facts.js';
import { installedSource } from '../inputs/sources.js';
import type { OptionConfig } from '../inputs/types.js';
import { checkBackgroundBinding } from '../marks/background-mark.js';
import { checkColorBinding } from '../marks/color.js';
import { checkPlainBinding } from '../marks/plain.js';
import { checkVerbosityBinding } from '../marks/verbosity.js';
import { carriesBinding } from '../plugins/extension.js';
import type { BuiltPlugin } from '../plugins/plugin.js';
import type { ApplicationOptions } from './types.js';

/** The core facts one Application declares, validated at construction and reported by `inspect()`. */
export interface ApplicationFacts {
  description: string | undefined;
  version: string;
}

/** Where one Application option sits, rebuilt as `new Application(name, { key })`. */
export function optionSite(name: string, key: string, value: unknown): FactSite {
  return slotSite({ call: 'new Application', named: name, subject: 'The Application' }, key, value);
}

/** The facts the Application's options declare. `options` is `undefined` for none. */
export function applicationFacts(
  options: Pick<ApplicationOptions, 'description' | 'version'> | undefined,
): ApplicationFacts {
  return {
    description: options?.description,
    version: options?.version ?? '0.0.0',
  };
}

/** The installed configuration source's binding, when one option's extension record carries it. */
export function carriedBinding(
  record: Readonly<Record<string, unknown>> | undefined,
  plugins: readonly BuiltPlugin[],
): string | undefined {
  const binding = installedSource(plugins)?.source.binding;
  return binding !== undefined && carriesBinding(record, binding) ? binding : undefined;
}

/**
 * An option that carries a mark read before configuration, the color mark, the plain mark, a
 * verbosity mark, or the background mark, carries no value of the installed source's binding.
 * `binding` is that binding when it does.
 */
export function checkMarkBindings(
  config: OptionConfig,
  site: FactSite,
  binding: string | undefined,
): void {
  checkColorBinding(config, site, binding);
  checkPlainBinding(config, site, binding);
  checkVerbosityBinding(config, site, binding);
  checkBackgroundBinding(config, site, binding);
}

/**
 * No plugin's option that carries a mark read before configuration carries the installed source's
 * binding. Only the constructor holds every plugin, so it judges each plugin's options against the
 * source another one installs.
 */
export function checkPluginMarkBindings(plugins: readonly BuiltPlugin[]): void {
  for (const installed of plugins) {
    const siteOf = pluginSites(installed.identity, installed.inputs);
    for (const input of installed.inputs) {
      const bound = carriedBinding(installed.records.get(input), plugins);
      checkMarkBindings(input.config, siteOf(input), bound);
    }
  }
}
