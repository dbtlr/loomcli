/*
 * The phrase an issue carries, kept beside it in a `WeakMap` so the issue holds no member beyond
 * its own: deep equality reads it as equal to the literal issue. Its key order is not promised,
 * because `phrasedIssue` writes `message` after the fields. Core registers the phrase again
 * wherever it copies an issue; a copy core does not make carries none.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { Phrase } from './phrase.js';

/** The phrase registered for each issue core or a joining package built through `phrasedIssue`. */
const issuePhrases = new WeakMap<object, Phrase>();

/** A new plain object, which an issue's members are assigned onto. */
function blank(): object {
  return {};
}

/**
 * A Standard Schema issue whose `message` is the phrase's English text, with the members of
 * `fields` beside it, such as its `path` or an issue code's `code` and `params`. Core keeps the
 * phrase for the issue, so it renders in the run's language where core repeats the issue for a
 * person, while the issue's `message` stays English.
 *
 * @example
 * ```ts
 * import { phrasedIssue, phrases } from '@loomcli/core';
 *
 * import * as notes from './notes/messages.js';
 *
 * const say = phrases('notes').module('notes', notes);
 * const issue = phrasedIssue(say('emptyTitle'), { path: ['title'] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/localization.md#phrases
 * @public
 */
function phrasedIssue<Fields extends object>(
  phrase: Phrase,
  // The path is checked apart from the other members, so an issue code's members alone compile.
  fields?: Fields & { readonly path?: StandardSchemaV1.Issue['path'] },
): StandardSchemaV1.Issue & Omit<Fields, 'message'> {
  // The phrase states the message, so it follows the fields and replaces any message they hold.
  // Object.assign keeps the fields' own type, where a spread of an optional value widens it.
  const issue: StandardSchemaV1.Issue & Omit<Fields, 'message'> = Object.assign(blank(), fields, {
    message: phrase.text,
  });
  issuePhrases.set(issue, phrase);
  return issue;
}

/**
 * The phrase registered for an issue while the issue's `message` equals the phrase's English text,
 * and `undefined` otherwise: for an issue nothing registered a phrase for, and for one whose
 * `message` was reworded. A sentence that repeats an issue passes the issue's phrase, or its
 * `message` when it carries none.
 *
 * @example
 * ```ts
 * import { issuePhrase } from '@loomcli/core';
 * import type { StandardSchemaV1 } from '@loomcli/core';
 *
 * declare const issue: StandardSchemaV1.Issue;
 *
 * const said = issuePhrase(issue) ?? issue.message;
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/localization.md#phrases
 * @public
 */
function issuePhrase(issue: StandardSchemaV1.Issue): Phrase | undefined {
  const phrase = issuePhrases.get(issue);
  return phrase !== undefined && phrase.text === issue.message ? phrase : undefined;
}

/** Registers the phrase one issue carries for a copy core made of it, and answers the copy. */
function carriedIssue<Issue extends StandardSchemaV1.Issue>(from: object, copy: Issue): Issue {
  const phrase = issuePhrases.get(from);
  if (phrase !== undefined && phrase.text === copy.message) {
    issuePhrases.set(copy, phrase);
  }
  return copy;
}

export { carriedIssue, issuePhrase, phrasedIssue };
