---
description: "The localization plugin: installs phrasebooks per language, so Loom's sentences render in the operator's language."
---

# Localization plugin

This page documents `localization()`, which installs phrasebooks per language so core renders Loom's own sentences in the operator's language. [Localization](../core/localization.md) states the core rules: how core reads the locale, what a phrasebook holds, where a phrase renders, and what stays English.

```ts
import { Application, escapeControlCharacters, phrasebook } from '@loomcli/core';
import { localization } from '@loomcli/plugins/localization';

const coreDe = phrasebook('@loomcli/core', {
  failures: {
    unknownOption: (spelling) =>
      `Unbekannte Option „${escapeControlCharacters(spelling)}“. Gib eine deklarierte Option an; stelle einem Pfad mit Bindestrich "./" voran.`,
  },
});

export const notes = new Application('notes', {
  plugins: [localization({ locales: { de: [coreDe] } })],
});
```

```text
$ LANG=de_AT.UTF-8 notes --bogus
notes: Unbekannte Option „--bogus“. Gib eine deklarierte Option an; stelle einem Pfad mit Bindestrich "./" voran.
$ LANG=C notes --bogus
notes: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".
```

- **The setting.** `localization(settings)` takes one setting, `locales`, a map from a language subtag to the list of phrasebooks for that language, each made by [`phrasebook()`](../core/localization.md#phrasebooks), which checks it against its package's sentences, whether it is written inline in the list or bound to a name. Its whole contribution is that map, as the plugin definition's `phrasebooks`; it declares no option, no middleware, no Command, no view, and no hook, and it claims no slot.
- **Language keys.** A key is a canonical language subtag: two or three lowercase ASCII letters that `Intl.getCanonicalLocales` returns unchanged, such as `de` or `fil`. Any other key is a declaration error under the rule [`@loomcli/core/phrasebook-language`](../core/diagnostics.md#loomclicorephrasebook-language), which `plugin()` raises, because a run's language is the first subtag of a canonical locale and never equals it. The sentence names the canonical language where one exists: `iw` is written `he`, `in` is written `id`, and `sh` is written `sr`. The canonical forms come from the runtime's own `Intl` data, which the locale resolver reads too, so a key and a run's language agree on each runtime; a few deprecated codes differ between runtimes, such as `tl`, which Node writes `fil` and Bun keeps. `de-AT`, `DE`, and `german` are refused the same way. A `de` list serves `de`, `de-AT`, and `de-CH` alike.
- **Order.** Within one list, the first phrasebook of a package that holds a sentence wins, so an application lists its own corrections ahead of a community phrasebook. Across plugins, installation order decides, as for views.
- **Fallback.** A sentence no phrasebook holds renders in English, and so does every sentence of a run whose language has no list. An `en` list rewords Loom's English sentences.
- **The plugin pack's sentences.** Until `@loomcli/plugins` joins localization, the plugin pack's own sentences render in English. An application that installs [`suggestions()`](suggestions.md) shows the unknown-option, unknown-command, and invalid-input sentences its views rewrite in English, because the views compose them from the failure's English `message`, while every sentence core writes through its own default text, and any hint a hook returns as a phrase, render in the run's language.
- **Opt-in.** Without the plugin, or another that installs phrasebooks, every output byte is the same as before.
- **Launch.** The phrasebooks load with the application module that imports them, every language's included, so an application that ships many languages chooses which ones a build imports.
- **Names.** `localization` and `LocalizationSettings` are exported from `@loomcli/plugins/localization`.

```ts sketch
interface LocalizationSettings {
  readonly locales: Readonly<Record<string, readonly Phrasebook[]>>;
}
function localization(settings: LocalizationSettings): Plugin;
```
