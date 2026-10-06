import { DeclarationError, quoted } from './errors.js';
import { declarerNote } from './facts.js';
import { shortAlias } from './input-rules.js';
import { shortAliasText, isShortAlias } from './options.js';
import { isPlainObject } from './plain.js';
import { notAnObject } from './plugin-rules.js';

/** The plugin factory whose settings a check judges: its plugin and the call that took them. */
interface SettingsDeclarer {
  /** The plugin's identity, which the sentence and each finding's note name. */
  readonly plugin: string;
  /** The factory's name, the call each finding quotes, such as `'format'`. */
  readonly call: string;
}

/** The plugin factory whose short spelling `checkShortSetting` judges, and the option it spells. */
interface ShortSettingDeclarer extends SettingsDeclarer {
  /** The name of the option the setting gives a short spelling, such as `'format'`. */
  readonly option: string;
}

/** One finding that quotes the factory's call with its settings and marks `mark` in it. */
function settingsFinding(settings: unknown, { call, plugin }: SettingsDeclarer, mark: string) {
  return { arguments: [settings], call, mark, note: declarerNote(plugin) };
}

/**
 * Judges a plugin factory's settings object at its call: settings that are neither undefined nor a
 * plain object are the not-an-object fault. It reads no key, so a factory judges its own settings
 * after it, and the finding quotes the factory's call and names the plugin.
 */
export function checkPluginSettings(settings: unknown, declarer: SettingsDeclarer): void {
  if (settings !== undefined && !isPlainObject(settings)) {
    throw new DeclarationError(notAnObject, {
      correction: 'Supply a settings object, or omit the settings.',
      findings: [settingsFinding(settings, declarer, '0')],
      sentence: `Plugin ${quoted(declarer.plugin)} declares settings that are not an object.`,
    });
  }
}

/**
 * Judges a plugin factory's settings at its call, under core's own rules: the settings object under
 * `checkPluginSettings`, then a `short` that is not one ASCII letter under the short-alias fault
 * every option's short spelling answers, in the same sentence. Each finding quotes the factory's
 * call and names the plugin, so a first-party plugin that takes a short spelling as `{ short }`
 * reports it where the author wrote it.
 */
export function checkShortSetting(settings: unknown, declarer: ShortSettingDeclarer): void {
  checkPluginSettings(settings, declarer);
  if (!isPlainObject(settings) || settings.short === undefined || isShortAlias(settings.short)) {
    return;
  }
  throw new DeclarationError(shortAlias, {
    ...shortAliasText(`Option ${quoted(declarer.option)}`),
    findings: [settingsFinding(settings, declarer, '0.short')],
  });
}
