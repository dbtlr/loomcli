import { git, readRegularFile } from './repository.js';

const decisionsDirectory = 'docs/decisions/';
const decisionIndex = `${decisionsDirectory}README.md`;
const recordName = /^\d{4}-[^/]+\.md$/u;

/**
 * The record a release cut writes when it marks a proposed decision accepted: the status, the
 * modified date, and a Status section that names the release, with every other line kept.
 * Undefined when the source is not a proposed record with one modified date and one Status section.
 */
function acceptedRecord(source: string, version: string, date: string) {
  const lines = source.split('\n');
  const close = lines.indexOf('---', 1);
  if (lines[0] !== '---' || close === -1) {
    return undefined;
  }
  const field = (key: string) =>
    lines.slice(1, close).flatMap((line, index) => (line.startsWith(`${key}:`) ? [index + 1] : []));
  const [status, ...extraStatus] = field('status');
  const [modified, ...extraModified] = field('modified');
  const headings = lines.flatMap((line, index) =>
    index > close && line === '## Status' ? [index] : [],
  );
  const [heading, ...extraHeadings] = headings;
  if (
    status === undefined ||
    lines[status] !== 'status: proposed' ||
    modified === undefined ||
    heading === undefined ||
    extraStatus.length + extraModified.length + extraHeadings.length > 0
  ) {
    return undefined;
  }
  const next = lines.findIndex((line, index) => index > heading && /^#{1,2} /u.test(line));
  const end = next === -1 ? lines.length : next;
  const fields = lines.map((line, index) => {
    if (index === status) {
      return 'status: accepted';
    }
    return index === modified ? `modified: ${date}` : line;
  });
  return [
    ...fields.slice(0, heading + 1),
    '',
    `Accepted in ${version}.`,
    '',
    ...fields.slice(end),
  ].join('\n');
}

/**
 * The index with each named record's status cell changed from proposed to accepted. Undefined when
 * a named record has no single row whose first cell links it and whose last cell reads proposed.
 */
function acceptedIndex(source: string, names: string[]) {
  const lines = source.split('\n');
  for (const name of names) {
    const rows = lines.flatMap((line, index) =>
      /^\[[^\]]+\]\((?<target>[^)]+)\)$/u.exec(line.split('|')[1]?.trim() ?? '')?.groups?.target ===
      name
        ? [index]
        : [],
    );
    const [row, ...extraRows] = rows;
    const text = row === undefined ? undefined : lines[row];
    const flipped = text?.replace(/\|(?<before>\s*)proposed(?<after>\s*)\|$/u, '|$1accepted$2|');
    if (row === undefined || extraRows.length > 0 || flipped === undefined || flipped === text) {
      return undefined;
    }
    lines[row] = flipped;
  }
  return lines.join('\n');
}

function present(root: string, ref: string, path: string) {
  return git(root, ['ls-tree', ref, '--', path]) !== '';
}

/**
 * Admits the decision files a release cut may change: each record it marks accepted, and the index
 * row of each one. Any other change to a record or the index throws naming the file. Returns the
 * admitted paths.
 */
export function checkDecisions(
  root: string,
  base: string,
  head: string,
  release: { date: string; version: string },
  changed: string[],
) {
  const records = changed.filter(
    (path) =>
      path.startsWith(decisionsDirectory) && recordName.test(path.slice(decisionsDirectory.length)),
  );
  for (const path of records) {
    const expected =
      present(root, base, path) && present(root, head, path)
        ? acceptedRecord(readRegularFile(root, path, base), release.version, release.date)
        : undefined;
    if (expected === undefined || readRegularFile(root, path, head) !== expected) {
      throw new Error(
        `${path}: a release cut changes a decision record only to mark a proposed decision accepted, with status accepted, modified ${release.date}, and a Status section that reads "Accepted in ${release.version}.". Make any other change in an ordinary PR.`,
      );
    }
  }
  if (records.length === 0 && !changed.includes(decisionIndex)) {
    return [];
  }
  const expected = present(root, base, decisionIndex)
    ? acceptedIndex(
        readRegularFile(root, decisionIndex, base),
        records.map((path) => path.slice(decisionsDirectory.length)),
      )
    : undefined;
  if (
    expected === undefined ||
    !present(root, head, decisionIndex) ||
    readRegularFile(root, decisionIndex, head) !== expected
  ) {
    throw new Error(
      `${decisionIndex}: a release cut changes the decision index only to mark each decision it accepts from proposed to accepted. Make any other change in an ordinary PR.`,
    );
  }
  return [...records, decisionIndex];
}
