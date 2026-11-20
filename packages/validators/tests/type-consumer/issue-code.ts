import { phrases } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { issueCode } from '@loomcli/validators';

// The program imports the public entry alone: a string and a phrase both compile as a message.
const schema: StandardSchemaV1<{ max: number }> = {
  '~standard': { validate: () => ({ value: { max: 1 } }), vendor: 'acme', version: 1 },
};

const words = { expectedMax: (max: number) => `At most ${String(max)}.` };

declare module '@loomcli/core' {
  interface MessagePackages {
    readonly '@acme/consumer': { readonly common: typeof words };
  }
}

const say = phrases('@acme/consumer').module('common', words);

const fromString = issueCode('@acme/consumer/from-string', {
  message: ({ max }) => `At most ${String(max)}.`,
  schema,
});

const fromPhrase = issueCode('@acme/consumer/from-phrase', {
  message: ({ max }) => say('expectedMax', max),
  schema,
});

issueCode('@acme/consumer/from-number', {
  // @ts-expect-error TS2322: a message returns a string or a phrase, not a number.
  message: ({ max }) => max,
  schema,
});

export { fromPhrase, fromString };
