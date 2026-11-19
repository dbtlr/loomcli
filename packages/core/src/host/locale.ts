/** The variables that name the locale of message text, in the order POSIX reads them. */
const localeVariables = ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const;

/** The modifiers that name a script, by the script subtag each becomes. */
const scriptModifiers: Readonly<Record<string, string>> = {
  cyrillic: 'Cyrl',
  devanagari: 'Deva',
  latin: 'Latn',
};

/** The modifiers that name a variant, which follows the rest of the tag. */
const variantModifiers: ReadonlySet<string> = new Set(['valencia']);

/** The locale a run reads when no variable names one, or the one named is not a tag. */
const english = 'en';

/** The first of the locale variables that is set and not empty, or none. */
function namedLocale(env: Readonly<Record<string, string | undefined>>): string | undefined {
  for (const name of localeVariables) {
    const value = env[name];
    if (value !== undefined && value !== '') {
      return value;
    }
  }
  return undefined;
}

/** One POSIX locale name's parts: the language and territory before any codeset, and the modifier. */
function posixParts(name: string): { readonly base: string; readonly modifier: string } {
  const [locale = '', modifier = ''] = name.split('@');
  const [base = ''] = locale.split('.');
  return { base, modifier: modifier.toLowerCase() };
}

/**
 * One POSIX locale name as a BCP 47 tag before canonical casing: its codeset dropped, `_` read as
 * `-`, and a modifier that names a script or a variant placed where the tag holds it.
 */
function posixTag(name: string): string | undefined {
  const { base, modifier } = posixParts(name);
  if (base === 'C' || base === 'POSIX') {
    return undefined;
  }
  const [language = '', ...rest] = base.replaceAll('_', '-').split('-');
  const script = Object.hasOwn(scriptModifiers, modifier) ? scriptModifiers[modifier] : undefined;
  const variant = variantModifiers.has(modifier) ? [modifier] : [];
  return [language, ...(script === undefined ? [] : [script]), ...rest, ...variant].join('-');
}

/**
 * The operator's locale as a canonical BCP 47 tag, read from the first of `LC_ALL`, `LC_MESSAGES`,
 * and `LANG` that is set and not empty. `C` and `POSIX` read `en`, a codeset drops, `_` reads as
 * `-`, a modifier that names a script becomes the script subtag, `@valencia` the variant
 * `valencia`, and any other modifier drops. No variable, and a value `Intl` refuses as a tag, read
 * `en`. `LANGUAGE` is not read.
 *
 * @example
 * ```ts
 * import { resolveLocale } from '@loomcli/core';
 *
 * resolveLocale({ LANG: 'de_AT.UTF-8' }); // 'de-AT'
 * resolveLocale({ LC_ALL: 'sr_RS@latin' }); // 'sr-Latn-RS'
 * resolveLocale({}); // 'en'
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/localization.md#the-locale
 * @public
 */
export function resolveLocale(env: Readonly<Record<string, string | undefined>>): string {
  const named = namedLocale(env);
  const tag = named === undefined ? undefined : posixTag(named);
  if (tag === undefined) {
    return english;
  }
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? english;
  } catch {
    return english;
  }
}

/**
 * The locale a run reads from its handle: the handle's own `locale`, read as an `LC_ALL` value,
 * unless it holds none or the empty string, and the handle's environment otherwise.
 */
export function handleLocale(
  locale: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string {
  return locale === undefined || locale === ''
    ? resolveLocale(env)
    : resolveLocale({ LC_ALL: locale });
}

/** The language a run matches phrasebooks by: its canonical locale's first subtag. */
export function localeLanguage(locale: string): string {
  return locale.split('-')[0] ?? locale;
}
