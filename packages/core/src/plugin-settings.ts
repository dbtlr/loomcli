import { DeclarationError, quoted } from './errors.js';
import { declarerNote } from './facts.js';
import { shortAlias } from './input-rules.js';
import { shortAliasText, isShortAlias } from './options.js';
import { isPlainObject } from './plain.js';
import { notAnObject } from './plugin-rules.js';

/** The plugin factory whose settings `checkShortSetting` judges, and the option `short` spells. */
interface ShortSettingDeclarer {
  /** The plugin's identity, which the sentence and each finding's note name. */
  readonly plugin: string;
  /** The factory's name, the call each finding quotes, such as `'format'`. */
  readonly call: string;
  /** The name of the option the setting gives a short spelling, such as `'format'`. */
  readonly option: string;
}

/**
 * Judges a plugin factory's settings at its call, under core's own rules: settings that are neither
 * undefined nor a plain object are the not-an-object fault, and a `short` that is not one ASCII
 * letter is the short-alias fault every option's short spelling answers, in the same sentence. Each
 * finding quotes the factory's call and names the plugin, so a first-party plugin that takes a short
 * spelling as `{ short }` reports it where the author wrote it.
 */
export function checkShortSetting(settings: unknown, declarer: ShortSettingDeclarer): void {
  if (settings === undefined) {
    return;
  }
  const { call, option, plugin } = declarer;
  const finding = (mark: string) => ({
    arguments: [settings],
    call,
    mark,
    note: declarerNote(plugin),
  });
  if (!isPlainObject(settings)) {
    throw new DeclarationError(notAnObject, {
      correction: 'Supply a settings object, or omit the settings.',
      findings: [finding('0')],
      sentence: `Plugin ${quoted(plugin)} declares settings that are not an object.`,
    });
  }
  if (settings.short !== undefined && !isShortAlias(settings.short)) {
    throw new DeclarationError(shortAlias, {
      ...shortAliasText(`Option ${quoted(option)}`),
      findings: [finding('0.short')],
    });
  }
}
