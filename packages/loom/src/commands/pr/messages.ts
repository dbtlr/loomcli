/*
 * The operator sentences of `loom pr check`, under ADR-0164: the failures its work and the helpers
 * that serve it raise, which check a pull request's fragments, its release files, and its decision
 * records, and the line it prints when every check passes. A launch never loads it, because only
 * the check's work and those helpers import it. Each is a function of the values it repeats, or a
 * constant, and the code that raises the failure or writes the line calls it. Every value a
 * sentence repeats is escaped, except `output`: the text another program or another failure wrote,
 * which a sentence repeats whole, its lines included. `tests/message-voice.test.ts` holds this
 * module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** Escapes one value a sentence repeats. */
const escaped = escapeControlCharacters;

// Pull request checks.

/**
 * The failure of PR checks in a shallow clone.
 *
 * @example
 * ```ts
 * prShallow; // 'PR checks require full Git history.'
 * ```
 */
const prShallow = 'PR checks require full Git history.';

/**
 * The failure of a release PR whose title is not the release title.
 *
 * @example
 * ```ts
 * expectedReleaseTitle; // 'Expected release title: chore(release): Release v<version> - <description>'
 * ```
 */
const expectedReleaseTitle =
  'Expected release title: chore(release): Release v<version> - <description>';

/**
 * The failure of a release branch that does not hold the base commit.
 *
 * @example
 * ```ts
 * releaseBranchBehind; // 'Release branch must include the current base commit. Update the release cut.'
 * ```
 */
const releaseBranchBehind =
  'Release branch must include the current base commit. Update the release cut.';

/**
 * The failure of a release PR that leaves fragments.
 *
 * @example
 * ```ts
 * fragmentsAfterCut; // 'No fragments may remain after a release cut.'
 * ```
 */
const fragmentsAfterCut = 'No fragments may remain after a release cut.';

/**
 * The failure of an ordinary PR that changes a library's version.
 *
 * @example
 * ```ts
 * versionMustStay('packages/core/package.json', '0.5.0');
 * // 'packages/core/package.json: ordinary PR version must stay 0.5.0.'
 * ```
 */
function versionMustStay(path: string, current: string): string {
  return `${escaped(path)}: ordinary PR version must stay ${escaped(current)}.`;
}

/**
 * The failure of a build-affecting PR without a fragment or `skip-changelog`.
 *
 * @example
 * ```ts
 * fragmentRequired; // 'Build-affecting PRs require an added or modified fragment or skip-changelog.'
 * ```
 */
const fragmentRequired =
  'Build-affecting PRs require an added or modified fragment or skip-changelog.';

/**
 * The failure of a release PR whose authoring skill is not a regular file at its head, with the
 * read's own failure.
 *
 * @example
 * ```ts
 * skillMissing('.agents/skills/loom/SKILL.md', 'git show failed: ...');
 * // '.agents/skills/loom/SKILL.md must exist at the head of a release PR as a regular file, ...'
 * ```
 */
function skillMissing(path: string, output: string): string {
  return `${escaped(path)} must exist at the head of a release PR as a regular file, so add it in an ordinary PR before the cut: ${output}`;
}

/**
 * Why the authoring skill names no version: it has no frontmatter.
 *
 * @example
 * ```ts
 * skillWithoutFrontmatter; // 'has no YAML frontmatter'
 * ```
 */
const skillWithoutFrontmatter = 'has no YAML frontmatter';

/**
 * Why the authoring skill names no version: its frontmatter is not YAML, with the parser's report.
 *
 * @example
 * ```ts
 * skillInvalidYaml('YAMLParseError: ...'); // 'has frontmatter that is not valid YAML: YAMLParseError: ...'
 * ```
 */
function skillInvalidYaml(output: string): string {
  return `has frontmatter that is not valid YAML: ${output}`;
}

/**
 * Why the authoring skill names no version: its frontmatter has no `metadata.version`.
 *
 * @example
 * ```ts
 * skillWithoutVersion; // 'has no metadata.version'
 * ```
 */
const skillWithoutVersion = 'has no metadata.version';

/**
 * Why the authoring skill names no version: its `metadata.version` is not a string.
 *
 * @example
 * ```ts
 * skillVersionNotString; // 'has a metadata.version that is not a string, so quote it'
 * ```
 */
const skillVersionNotString = 'has a metadata.version that is not a string, so quote it';

/**
 * The failure of a release PR whose authoring skill names no version, and why. The reason is a
 * sentence part of this module, and the YAML parser's report it may hold keeps its lines.
 *
 * @example
 * ```ts
 * skillVersionUnset('.agents/skills/loom/SKILL.md', skillWithoutVersion, '0.5.0');
 * // '.agents/skills/loom/SKILL.md has no metadata.version. Set its metadata.version to "0.5.0" ...'
 * ```
 */
function skillVersionUnset(path: string, output: string, version: string): string {
  return `${escaped(path)} ${output}. Set its metadata.version to "${escaped(version)}" in an ordinary PR before the cut.`;
}

/**
 * The failure of a release PR whose authoring skill names another version.
 *
 * @example
 * ```ts
 * skillVersionMismatch('.agents/skills/loom/SKILL.md', '0.4.0', '0.5.0');
 * // '.agents/skills/loom/SKILL.md carries metadata.version 0.4.0, not title version 0.5.0. ...'
 * ```
 */
function skillVersionMismatch(path: string, found: string, version: string): string {
  return `${escaped(path)} carries metadata.version ${escaped(found)}, not title version ${escaped(version)}. Review the skill against the release and set its metadata.version to "${escaped(version)}" in an ordinary PR before the cut.`;
}

/**
 * The failure of a release PR that rewrites the changelog's introduction or earlier releases.
 *
 * @example
 * ```ts
 * changelogRewritten; // 'CHANGELOG.md must preserve its introduction and earlier releases.'
 * ```
 */
const changelogRewritten = 'CHANGELOG.md must preserve its introduction and earlier releases.';

/**
 * The failure of a release PR whose section has no compiled heading and date.
 *
 * @example
 * ```ts
 * noCompiledHeading; // 'CHANGELOG.md requires a compiled release heading and date.'
 * ```
 */
const noCompiledHeading = 'CHANGELOG.md requires a compiled release heading and date.';

/**
 * The failure of a release PR whose libraries do not carry the title version.
 *
 * @example
 * ```ts
 * librariesOffTitle('0.5.0'); // 'Every participating library must carry title version 0.5.0.'
 * ```
 */
function librariesOffTitle(version: string): string {
  return `Every participating library must carry title version ${escaped(version)}.`;
}

/**
 * The failure of a release PR that changes the set of participating libraries.
 *
 * @example
 * ```ts
 * librariesChanged; // 'Release cuts cannot change participating libraries.'
 * ```
 */
const librariesChanged = 'Release cuts cannot change participating libraries.';

/**
 * The failure of a release PR that changes a library's manifest beyond its version.
 *
 * @example
 * ```ts
 * onlyVersionField('packages/core/package.json');
 * // 'packages/core/package.json: release cuts change only the version field.'
 * ```
 */
function onlyVersionField(path: string): string {
  return `${escaped(path)}: release cuts change only the version field.`;
}

/**
 * The failure of a release PR that changes a file outside the cut.
 *
 * @example
 * ```ts
 * outsideCut('README.md'); // 'README.md: outside the release cut.'
 * ```
 */
function outsideCut(path: string): string {
  return `${escaped(path)}: outside the release cut.`;
}

/**
 * The failure of a release PR that changes a file's mode.
 *
 * @example
 * ```ts
 * fileModeChanged('install.sh'); // 'install.sh: release cuts cannot change a file mode.'
 * ```
 */
function fileModeChanged(path: string): string {
  return `${escaped(path)}: release cuts cannot change a file mode.`;
}

/**
 * The failure of a release PR whose lockfile is not the version writer's.
 *
 * @example
 * ```ts
 * lockfileMismatch; // 'pnpm-lock.yaml must match the version writer; ...'
 * ```
 */
const lockfileMismatch =
  'pnpm-lock.yaml must match the version writer; unrelated lockfile changes need an ordinary PR.';

/**
 * The failure of a release PR whose section is not the compiler's output.
 *
 * @example
 * ```ts
 * sectionNotCompiled; // 'CHANGELOG.md must contain the compiler output for the consumed fragments.'
 * ```
 */
const sectionNotCompiled =
  'CHANGELOG.md must contain the compiler output for the consumed fragments.';

/**
 * The failure of a release PR with more or less than one compiled section.
 *
 * @example
 * ```ts
 * oneCompiledSection; // 'CHANGELOG.md must contain exactly one compiled release section.'
 * ```
 */
const oneCompiledSection = 'CHANGELOG.md must contain exactly one compiled release section.';

/**
 * The failure of a release PR that changes a decision record beyond accepting it.
 *
 * @example
 * ```ts
 * decisionRecordChanged('docs/decisions/0001-x.md', '2026-11-16', '0.5.0');
 * // 'docs/decisions/0001-x.md: a release cut changes a decision record only to mark ...'
 * ```
 */
function decisionRecordChanged(path: string, date: string, version: string): string {
  return `${escaped(path)}: a release cut changes a decision record only to mark a proposed decision accepted, with status accepted, modified ${escaped(date)}, and a Status section that reads "Accepted in ${escaped(version)}.". Make any other change in an ordinary PR.`;
}

/**
 * The failure of a release PR that changes the decision index beyond accepting records.
 *
 * @example
 * ```ts
 * decisionIndexChanged('docs/decisions/README.md');
 * // 'docs/decisions/README.md: a release cut changes the decision index only to mark ...'
 * ```
 */
function decisionIndexChanged(index: string): string {
  return `${escaped(index)}: a release cut changes the decision index only to mark each decision it accepts from proposed to accepted. Make any other change in an ordinary PR.`;
}

// Commands: pull requests.

/**
 * The confirmation of `loom pr check`.
 *
 * @example
 * ```ts
 * prChecksPassed; // 'PR checks passed.'
 * ```
 */
const prChecksPassed = 'PR checks passed.';

export {
  changelogRewritten,
  decisionIndexChanged,
  decisionRecordChanged,
  expectedReleaseTitle,
  fileModeChanged,
  fragmentRequired,
  fragmentsAfterCut,
  librariesChanged,
  librariesOffTitle,
  lockfileMismatch,
  noCompiledHeading,
  oneCompiledSection,
  onlyVersionField,
  outsideCut,
  prChecksPassed,
  prShallow,
  releaseBranchBehind,
  sectionNotCompiled,
  skillInvalidYaml,
  skillMissing,
  skillVersionMismatch,
  skillVersionNotString,
  skillVersionUnset,
  skillWithoutFrontmatter,
  skillWithoutVersion,
  versionMustStay,
};
