import { phrasebook } from '@loomcli/core';

const german = phrasebook('@loomcli/prompts', {
  common: {
    interactionUnavailable: (question, command) => `Frage ${question}: ${command}`,
  },
});

phrasebook('@loomcli/prompts', {
  common: {
    // @ts-expect-error TS2353: the module has no sentence with this name.
    interactionRequired: 'Ein Terminal ist erforderlich.',
  },
});

phrasebook('@loomcli/prompts', {
  common: {
    // @ts-expect-error TS2322: the question is a string.
    interactionUnavailable: (question: number) => String(question),
  },
});

phrasebook('@loomcli/prompts', {
  common: {
    // @ts-expect-error TS2353: a confirm legend's letters are the keys the answer accepts, so no phrasebook rewrites them.
    confirmKeys: 'j/n',
  },
});

export { german };
export { text } from '@loomcli/prompts';
