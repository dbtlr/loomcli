import { issuePhrase, phrases } from '@loomcli/core';
import type { Phrase, StandardSchemaV1 } from '@loomcli/core';

// The phrase maker binds the message module as a whole.
// oxlint-disable-next-line import/no-namespace
import * as common from './messages.js';

const promptPhrase = phrases('@loomcli/prompts').module('common', common);

/** The first rejection a question shows, preserving a phrase the validator attached to it. */
function rejection(issues: readonly StandardSchemaV1.Issue[]): string | Phrase {
  const issue = issues[0];
  return issue === undefined
    ? promptPhrase('invalidAnswer')
    : (issuePhrase(issue) ?? issue.message);
}

export { promptPhrase, rejection };
