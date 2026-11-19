import { escapeControlCharacters, phrasebook, phrasedIssue, phrases, plugin } from '@loomcli/core';
import type { MessagePackages, Phrasebook, PhrasebookSentences } from '@loomcli/core';
import { localization } from '@loomcli/plugins/localization';

// A phrasebook checks each entry against its package's message modules, by module and then by name.
const coreDe: Phrasebook = phrasebook('@loomcli/core', {
  failures: {
    genericDefect: 'Etwas ist schiefgelaufen.',
    unknownOption: (spelling) => `Unbekannte Option „${escapeControlCharacters(spelling)}“.`,
  },
  inputs: { silentRejection: 'Der Wert wurde abgelehnt.' },
});

// A module's sentences declared apart are checked whole once annotated.
const failuresDe: PhrasebookSentences<'@loomcli/core'>['failures'] = {
  repeatedOption: (spelling) => `Option „${spelling}“ doppelt.`,
};
const annotated = phrasebook('@loomcli/core', { failures: failuresDe });

// The plugin installs phrasebooks made by phrasebook(), written inline or bound to a name.
const installed = localization({
  locales: { de: [coreDe, phrasebook('@loomcli/core', { output: {} })] },
});
const wrapped = plugin('community-de', { phrasebooks: { de: [coreDe] } });

// @ts-expect-error TS2345: a package no member of MessagePackages declares.
phrasebook('@loomcli/coer', {});

phrasebook('@loomcli/core', {
  failures: {
    // @ts-expect-error TS2561: a misspelled sentence.
    unknownOptoin: 'x',
  },
});

phrasebook('@loomcli/core', {
  // @ts-expect-error TS2561: a misspelled module.
  failurs: {},
});

phrasebook('@loomcli/core', {
  failures: {
    // @ts-expect-error TS2322: a parameter of the wrong type.
    unknownOption: (spelling: number) => String(spelling),
  },
});

phrasebook('@loomcli/core', {
  failures: {
    // @ts-expect-error TS2322: a function where the export is a constant.
    genericDefect: () => 'Etwas ist schiefgelaufen.',
  },
});

phrasebook('@loomcli/core', {
  failures: {
    // @ts-expect-error TS2322: an entry that does not return a string.
    unknownOption: (spelling: string) => spelling.length,
  },
});

localization({
  // @ts-expect-error TS2741: an object shaped like a phrasebook is not one.
  locales: { de: [{ package: '@loomcli/core' }] },
});

// An application registers its own message module and says its sentences through phrases().
const notes = {
  emptyTitle: 'The title is empty.',
  saved: (name: string): string => `Saved "${escapeControlCharacters(name)}".`,
};

declare module '@loomcli/core' {
  interface MessagePackages {
    'type-consumer': { readonly notes: typeof notes };
  }
}

const registered: keyof MessagePackages = 'type-consumer';
const say = phrases('type-consumer').module('notes', notes);
const saved = say('saved', 'list');
const nested = say('saved', say('emptyTitle'));

// @ts-expect-error TS2345: a value of the wrong type.
say('saved', 1);

// @ts-expect-error TS2345: a sentence the module does not export.
say('removed', 'list');

// @ts-expect-error TS2345: a module the package does not register.
phrases('type-consumer').module('other', notes);

// An issue code's members, with or without a path, are built with the phrase in one call.
const coded = phrasedIssue(say('emptyTitle'), { code: 'text-empty', params: { min: 1 } });
const codedCode: string = coded.code;
const placed = phrasedIssue(say('emptyTitle'), { code: 'text-empty', path: ['title'] });

// @ts-expect-error TS2322: a path of the wrong type.
phrasedIssue(say('emptyTitle'), { path: 3 });

export { annotated, codedCode, coreDe, installed, nested, placed, registered, saved, wrapped };
