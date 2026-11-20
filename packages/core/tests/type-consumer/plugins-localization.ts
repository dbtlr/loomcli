import { escapeControlCharacters, phrasebook } from '@loomcli/core';
import type { Phrasebook, PhrasebookSentences } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';

// The plugin pack's member of MessagePackages comes with any of its subpaths, here the help plugin.
const pluginsDe: Phrasebook = phrasebook('@loomcli/plugins', {
  common: { recordCount: (count) => `${String(count)} Einträge` },
  config: { booleanIssue: 'Verwende true oder false.' },
  help: {
    usageHeading: 'VERWENDUNG',
    usageHint: (command) => `Führe "${command.map(escapeControlCharacters).join(' ')}" aus.`,
  },
  suggestions: { valueSuggestion: (name) => `Meintest du "${escapeControlCharacters(name)}"?` },
});

// A module's sentences declared apart are checked whole once annotated.
const helpDe: PhrasebookSentences<'@loomcli/plugins'>['help'] = { repeatableFact: 'wiederholbar' };
const annotatedPlugins = phrasebook('@loomcli/plugins', { help: helpDe });
const installedHelp = help();

phrasebook('@loomcli/plugins', {
  help: {
    // @ts-expect-error TS2561: a misspelled sentence.
    usageHeadng: 'VERWENDUNG',
  },
});

phrasebook('@loomcli/plugins', {
  help: {
    // @ts-expect-error TS2322: a parameter of the wrong type.
    usageHint: (command: number) => String(command),
  },
});

phrasebook('@loomcli/plugins', {
  // @ts-expect-error TS2561: a misspelled module.
  helps: {},
});

export { annotatedPlugins, installedHelp, pluginsDe };
