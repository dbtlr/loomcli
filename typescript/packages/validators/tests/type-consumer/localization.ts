import { phrasebook, plugin } from '@loomcli/core';
import type { Phrasebook, PhrasebookSentences } from '@loomcli/core';
import { text } from '@loomcli/validators';

// The program imports the validators' public entry alone, and its declarations bring the
// Package's member of `MessagePackages` with them, so a phrasebook checks each sentence.
const validator = text({ maxLength: 3 });

const validatorsDe: Phrasebook = phrasebook('@loomcli/validators', {
  common: {
    expectedLengthRange: (min, max) => `Erwartet ${String(min)} bis ${String(max)} Zeichen.`,
    expectedPort: 'Erwartet eine Portnummer von 1 bis 65535.',
  },
});

const sentences: PhrasebookSentences<'@loomcli/validators'>['common'] = {
  expectedNonempty: 'Erwartet einen nichtleeren Wert.',
};
const annotated = phrasebook('@loomcli/validators', { common: sentences });
const wrapped = plugin('validators-de', { phrasebooks: { de: [validatorsDe, annotated] } });

phrasebook('@loomcli/validators', {
  common: {
    // @ts-expect-error TS2561: a misspelled sentence.
    expectedPrt: 'x',
  },
});

phrasebook('@loomcli/validators', {
  common: {
    // @ts-expect-error TS2322: a parameter of the wrong type.
    expectedLengthRange: (min: string) => min,
  },
});

phrasebook('@loomcli/validators', {
  common: {
    // @ts-expect-error TS2322: a function where the export is a constant.
    expectedPort: () => 'x',
  },
});

export { validator, wrapped };
