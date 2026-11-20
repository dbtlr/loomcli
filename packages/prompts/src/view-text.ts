import { Phrase } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

/** What refuses an answer: English text, a phrase, or the phrases of its sentences, said in order on one line. */
type Issue = string | Phrase | readonly Phrase[];

/** The English text of an issue, the sentences of a list joined by a space. */
function englishIssue(issue: Issue): string {
  if (typeof issue === 'string') {
    return issue;
  }
  return issue instanceof Phrase ? issue.text : issue.map((phrase) => phrase.text).join(' ');
}

/** A view's public data keeps its English strings. A phrase travels alongside the data. */
const issues = new WeakMap<object, Exclude<Issue, string>>();
const hints = new WeakMap<object, { readonly phrase: Phrase; readonly brackets: boolean }>();

function withIssue<Data extends object>(data: Data, issue: Issue): Data & { issue: string };
function withIssue<Data extends object>(
  data: Data,
  issue: Issue | undefined,
): Data & { issue: string | undefined };
function withIssue<Data extends object>(data: Data, issue: Issue | undefined) {
  if (issue !== undefined && typeof issue !== 'string') {
    issues.set(data, issue);
  }
  return Object.assign(data, { issue: issue === undefined ? undefined : englishIssue(issue) });
}

function localizedIssue<Data extends { readonly issue: string | undefined }>(
  data: Data,
  context: ViewContext,
): Data['issue'] | string {
  const issue = issues.get(data);
  if (issue === undefined) {
    return data.issue;
  }
  return issue instanceof Phrase
    ? context.localize(issue)
    : issue.map((phrase) => context.localize(phrase)).join(' ');
}

/** Brackets belong to the live confirm hint. The line view adds its own. */
function withHint<Data extends object>(
  data: Data,
  hint: string | Phrase | undefined,
  brackets = false,
): Data & { hint: string | undefined } {
  if (hint instanceof Phrase) {
    hints.set(data, { brackets, phrase: hint });
  }
  const text = hint instanceof Phrase ? hint.text : hint;
  return Object.assign(data, { hint: brackets ? `[${text}]` : text });
}

function localizedHint(
  data: { readonly hint: string | undefined },
  context: ViewContext,
): string | undefined {
  const hint = hints.get(data);
  if (hint === undefined) {
    return data.hint;
  }
  const text = context.localize(hint.phrase);
  return hint.brackets ? `[${text}]` : text;
}

export type { Issue };
export { localizedHint, localizedIssue, withHint, withIssue };
