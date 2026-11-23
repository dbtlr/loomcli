/*
 * The operator sentences of `loom pr check` and the helpers that serve it, under ADR-0164. A launch
 * never loads it. Every value is escaped, except `output`. `tests/message-voice.test.ts` holds this
 * module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const escaped = escapeControlCharacters;

// Pull request checks.

const prShallow = 'PR checks require full Git history.';

const expectedReleaseTitle =
  'Expected release title: chore(release): Release v<version> - <description>';

const releaseBranchBehind =
  'Release branch must include the current base commit. Update the release cut.';

const fragmentsAfterCut = 'No fragments may remain after a release cut.';

function versionMustStay(path: string, current: string): string {
  return `${escaped(path)}: ordinary PR version must stay ${escaped(current)}.`;
}

const fragmentRequired =
  'Build-affecting PRs require an added or modified fragment or skip-changelog.';

function skillMissing(path: string, output: string): string {
  return `${escaped(path)} must exist at the head of a release PR as a regular file, so add it in an ordinary PR before the cut: ${output}`;
}

const skillWithoutFrontmatter = 'has no YAML frontmatter';

function skillInvalidYaml(output: string): string {
  return `has frontmatter that is not valid YAML: ${output}`;
}

const skillWithoutVersion = 'has no metadata.version';

const skillVersionNotString = 'has a metadata.version that is not a string, so quote it';

function skillVersionUnset(path: string, output: string, version: string): string {
  return `${escaped(path)} ${output}. Set its metadata.version to "${escaped(version)}" in an ordinary PR before the cut.`;
}

function skillVersionMismatch(path: string, found: string, version: string): string {
  return `${escaped(path)} carries metadata.version ${escaped(found)}, not title version ${escaped(version)}. Review the skill against the release and set its metadata.version to "${escaped(version)}" in an ordinary PR before the cut.`;
}

const changelogRewritten = 'CHANGELOG.md must preserve its introduction and earlier releases.';

const noCompiledHeading = 'CHANGELOG.md requires a compiled release heading and date.';

function librariesOffTitle(version: string): string {
  return `Every participating library must carry title version ${escaped(version)}.`;
}

const librariesChanged = 'Release cuts cannot change participating libraries.';

function onlyVersionField(path: string): string {
  return `${escaped(path)}: release cuts change only the version field.`;
}

function outsideCut(path: string): string {
  return `${escaped(path)}: outside the release cut, so make the change in an ordinary PR.`;
}

function fileModeChanged(path: string): string {
  return `${escaped(path)}: release cuts cannot change a file mode.`;
}

const lockfileMismatch =
  'pnpm-lock.yaml must match the version writer; unrelated lockfile changes need an ordinary PR.';

const sectionNotCompiled =
  'CHANGELOG.md must contain the compiler output for the consumed fragments.';

const oneCompiledSection = 'CHANGELOG.md must contain exactly one compiled release section.';

function decisionRecordChanged(path: string, date: string, version: string): string {
  return `${escaped(path)}: a release cut changes a decision record only to mark a proposed decision accepted, with status accepted, modified ${escaped(date)}, and a Status section that reads "Accepted in ${escaped(version)}.". Make any other change in an ordinary PR.`;
}

function decisionIndexChanged(index: string): string {
  return `${escaped(index)}: a release cut changes the decision index only to mark each decision it accepts from proposed to accepted. Make any other change in an ordinary PR.`;
}

// Commands: pull requests.

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
