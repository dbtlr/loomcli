/*
 * The operator sentences of `loom release` and the helpers that serve it, under ADR-0164. `loom pr
 * check` loads this module too. A launch never does. Every value is escaped, except `output`.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const escaped = escapeControlCharacters;

// Repository reads.

function noVersionCommit(version: string): string {
  return `No first-parent commit sets version ${escaped(version)}, so set the version in a commit on the branch's first-parent history, or name the revision a cut covers with loom release cut --since <revision>.`;
}

// Synchronized releases.

const initialNeedsZero = '--initial requires library version 0.0.0.';

const noFragments = 'No fragments to release, so add a fragment to .changes/ first.';

const stableTargetOnly = 'Release target must be a stable 0.x version.';

function targetBelowRelease(minimum: string, current: string): string {
  return `Release target must be at least ${escaped(minimum)}; current version is ${escaped(current)}.`;
}

function releaseWithoutEntries(version: string): string {
  return `Release v${escaped(version)} carries no entries, so it requires a narrative for its notes.`;
}

function tagExists(version: string): string {
  return `Tag v${escaped(version)} already exists, so cut a version no tag names with loom release cut --target <version>.`;
}

// Lockfiles.

const pnpmMissing =
  'Preparing pnpm-lock.yaml requires pnpm, an optional peer dependency of @loomcli/loom. Install pnpm 12.16.1 or later beside @loomcli/loom and run the command again.';

const lockfileInvalidYaml =
  'pnpm-lock.yaml is invalid YAML, so regenerate it with pnpm install, commit it, and run loom release cut again.';

function lockfileTimedOut(seconds: number): string {
  return `Lockfile preparation did not finish within ${String(seconds)} seconds, so pnpm was stopped. Check that pnpm can reach the registry, then run loom release cut again.`;
}

function lockfilePreparationFailed(output: string): string {
  return `Lockfile preparation failed, so fix what pnpm reported and run loom release cut again:\n${output}`;
}

// Services.

function invalidJsonAnswer(url: string): string {
  return `${escaped(url)} answered with invalid JSON, so check that --registry and --github-api name the registry and the GitHub API, then run the command again.`;
}

function refusedRequest(method: string, url: string, status: number, output: string): string {
  return `${escaped(method)} ${escaped(url)} answered ${String(status)}, so fix what it reported and run the command again: ${output}`;
}

function requestTimedOut(method: string, url: string, deadlineMs: number): string {
  return `${escaped(method)} ${escaped(url)} did not answer within ${String(deadlineMs)} ms, so run the command again, with a larger --request-timeout-ms if the service is slow.`;
}

function requestUnreached(method: string, url: string): string {
  return `${escaped(method)} ${escaped(url)} could not be reached. Check your network connection, then run the command again.`;
}

function answerBrokeOff(method: string, url: string): string {
  return `${escaped(method)} ${escaped(url)} stopped before its answer ended. Check your network connection, then run the command again.`;
}

function provenanceNotJson(url: string): string {
  return `GET ${escaped(url)} answered with a provenance statement that is not JSON, so check that --registry names an npm registry, then run the command again.`;
}

function neverAppeared(subject: string, attempts: number): string {
  return `${escaped(subject)} did not appear after ${String(attempts)} attempts, so run the command again once the service's write has propagated, with a larger --retry-attempts if it is slow.`;
}

function tagObjectMissing(tag: string, sha: string): string {
  return `Tag ${escaped(tag)} names tag object ${escaped(sha)}, which the API does not return, so check that --github-api names the API that serves the repository, then run the command again.`;
}

function uploadOriginRefused(origin: string, api: string, upload: string): string {
  return `The Release publishes its upload endpoint at ${escaped(origin)}, which is neither ${escaped(api)} nor ${escaped(upload)}, so loom sent it nothing. Name the API that serves the Release with --github-api, then run the command again.`;
}

function provenanceElsewhere(
  name: string,
  version: string,
  attested: readonly string[],
  purl: string,
): string {
  return `${escaped(name)}@${escaped(version)}: its provenance attests ${escaped(attested.join(', ') || 'nothing')}, not ${escaped(purl)}, so supersede ${escaped(version)} with the next cut.`;
}

function provenanceWithoutSource(name: string, version: string): string {
  return `${escaped(name)}@${escaped(version)}: its provenance resolves no source repository, so supersede ${escaped(version)} with the next cut.`;
}

function unsupportedIntegrity(subject: string, integrity: string): string {
  return `${escaped(subject)}: the registry reports unsupported integrity ${escaped(integrity)}, and loom verifies sha512 digests only, so check that --registry names an npm registry, then run the command again.`;
}

function integrityMismatch(subject: string, actual: string, integrity: string): string {
  return `${escaped(subject)}: the downloaded tarball hashes to sha512-${escaped(actual)}, not ${escaped(integrity)}, so run the command again, and if the digests still differ, check that --registry names the registry the libraries were published to.`;
}

// Release plans.

function noChangelogSection(version: string): string {
  return `CHANGELOG.md has no v${escaped(version)} section, so restore the section the release cut wrote, then run the command again.`;
}

function sectionWithoutNotes(version: string): string {
  return `CHANGELOG.md: the v${escaped(version)} section has no notes, so add its notes below the heading, then run the command again.`;
}

function abandonedVersion(version: string, reason: string): string {
  return `Version ${escaped(version)} is absent from the registry and ${escaped(reason)} Publication attests the head, so ${escaped(version)} must be abandoned as unpublished and superseded by the next cut.`;
}

function changedSinceCut(paths: readonly string[], cutCommit: string, head: string): string {
  return `${escaped(paths.join(', '))} changed between the cut commit ${escaped(cutCommit)} and the head ${escaped(head)}.`;
}

function tagNamesOther(tag: string, tagCommit: string, head: string): string {
  return `tag ${escaped(tag)} already names ${escaped(tagCommit)} instead of the head ${escaped(head)}.`;
}

function provenanceConflict(
  name: string,
  version: string,
  commit: string,
  earlier: string,
): string {
  return `${escaped(name)}@${escaped(version)} was published from ${escaped(commit)}, but an earlier library names ${escaped(earlier)}, so supersede ${escaped(version)} with the next cut.`;
}

function tagWithoutProvenance(tag: string, tagCommit: string, version: string): string {
  return `Tag ${escaped(tag)} names ${escaped(tagCommit)}, but the registry reports no provenance for ${escaped(version)}, so the commit it was published from is unknown. Run the command again once the registry reports its provenance.`;
}

function tagAwayFromPublication(
  tag: string,
  tagCommit: string,
  version: string,
  commit: string,
): string {
  return `Tag ${escaped(tag)} names ${escaped(tagCommit)}, but ${escaped(version)} was published from ${escaped(commit)}, and recording never moves a tag, so supersede ${escaped(version)} with the next cut.`;
}

function outputFolderMissing(path: string): string {
  return `Cannot write ${escaped(path)}, because its folder does not exist. Create the folder, then run the command again.`;
}

function planNotJson(path: string): string {
  return `${escaped(path)} is not valid JSON, so write the plan again with loom release plan, then run loom release record again.`;
}

function planNotJsonAt(
  path: string,
  { column, expected, line }: { column: number; expected: string; line: number },
): string {
  return `${escaped(path)} is not valid JSON: line ${String(line)}, column ${String(column)} needs ${escaped(expected)}, so write the plan again with loom release plan, then run loom release record again.`;
}

const planWithoutNotes =
  'A plan for a released version carries notes, so write the plan again with loom release plan.';

function unreleasedPlan(version: string, head: string): string {
  return `${escaped(version)} is the unreleased version at head ${escaped(head)}, so there is nothing to reconcile.\nPublish: no. Record: no.`;
}

function planHeading(tag: string, head: string, cutCommit: string): string {
  return `Plan ${escaped(tag)} at head ${escaped(head)}, cut commit ${escaped(cutCommit)}.`;
}

function libraryState(name: string, published: boolean): string {
  return `${escaped(name)}: ${published ? 'published' : 'absent from the registry'}.`;
}

function tagState(tag: string, commit: string | null): string {
  return `Tag ${escaped(tag)}: ${commit === null ? 'absent' : `present at ${escaped(commit)}`}.`;
}

function releaseState(tag: string, present: boolean): string {
  return `Release ${escaped(tag)}: ${present ? 'present' : 'absent'}.`;
}

function planDecision(publish: boolean, record: boolean): string {
  return `Publish: ${publish ? 'yes' : 'no'}. Record: ${record ? 'yes' : 'no'}.`;
}

// Release records.

function onRegistry(subject: string): string {
  return `${escaped(subject)} on the registry`;
}

function provenanceOf(subject: string): string {
  return `the provenance of ${escaped(subject)}`;
}

function tarballOf(subject: string): string {
  return `the ${escaped(subject)} tarball`;
}

function theTag(tag: string): string {
  return `the tag ${escaped(tag)}`;
}

function theRelease(tag: string): string {
  return `the ${escaped(tag)} Release`;
}

function theAsset(name: string): string {
  return `the ${escaped(name)} asset`;
}

function readFromRegistry(subject: string): string {
  return `Read ${escaped(subject)} from the registry.`;
}

function provenanceNotOurs(subject: string, uri: string, source: string): string {
  return `${escaped(subject)}: its provenance names ${escaped(uri)}, which is not a build of ${escaped(source)}, so check that --repository names the repository the release workflow published from, then run the command again.`;
}

function verifiedTarball(subject: string, integrity: string): string {
  return `Verified the ${escaped(subject)} tarball against ${escaped(integrity)}.`;
}

function commitOutsideCheckout(subject: string, commit: string, head: string): string {
  return `${escaped(subject)} was published from ${escaped(commit)}, which is neither the head ${escaped(head)} of the checkout nor an ancestor of it, so run the command in a checkout whose head is that commit or follows it.`;
}

function uploadsDisagree(
  subject: string,
  commit: string,
  firstSubject: string,
  firstCommit: string,
): string {
  return `${escaped(subject)} was published from ${escaped(commit)}, but ${escaped(firstSubject)} was published from ${escaped(firstCommit)}, so supersede the version with the next cut.`;
}

function createdTag(tag: string, commit: string): string {
  return `Created the annotated tag ${escaped(tag)} at ${escaped(commit)}.`;
}

function reusedTag(tag: string, commit: string): string {
  return `Reused the tag ${escaped(tag)} at ${escaped(commit)}.`;
}

function createdRelease(tag: string): string {
  return `Created the ${escaped(tag)} Release.`;
}

function reusedRelease(tag: string): string {
  return `Reused the ${escaped(tag)} Release.`;
}

function keptAsset(name: string): string {
  return `Kept the ${escaped(name)} asset.`;
}

function deletedAsset(name: string): string {
  return `Deleted the unfinished ${escaped(name)} asset.`;
}

function uploadedAsset(name: string): string {
  return `Uploaded the ${escaped(name)} asset.`;
}

function recorded(tag: string): string {
  return `Recorded ${escaped(tag)}.`;
}

// Commands: releases.

const cutFromWorkspace =
  'Run release cut from the workspace directory, the one that holds pnpm-workspace.yaml.';

const cleanCheckoutRequired =
  'release cut requires a clean checkout. Commit the release inputs first.';

const checkoutChanged =
  'Checkout changed during release preparation, so nothing was written. Wait for any other writer to finish, then run loom release cut again from a clean checkout.';

function changedDuringPreparation(path: string): string {
  return `${escaped(path)} changed during release preparation, so nothing was written. Wait for any other writer to finish, then run loom release cut again from a clean checkout.`;
}

function rollbackIncomplete(failed: readonly string[]): string {
  return `Release rollback incomplete for ${escaped(failed.join(', '))}. Use a fresh isolated checkout.`;
}

function lockExists(lock: string): string {
  return `Release lock already exists at ${escaped(lock)}. Another writer may be active. After an interrupted write, use a fresh isolated checkout.`;
}

const tokenRequired = 'Recording a release requires GH_TOKEN.';

const formulaRepositoryRequired =
  'package.json names no GitHub repository. Set repository to a GitHub address such as owner/name, then run loom release formula again.';

function formulaMetadataRequired(field: string): string {
  return `package.json has no text for ${escaped(field)}. Set that field, then run loom release formula again.`;
}

function invalidFormulaPath(path: string): string {
  return `${escaped(path)} cannot name a Homebrew formula. Pass a path such as Formula/my-app.rb with --output.`;
}

function missingFormulaChecksum(path: string, asset: string): string {
  return `${escaped(path)} has no SHA-256 checksum for ${escaped(asset)}. Pass the published release's SHA256SUMS listing that asset with --checksums.`;
}

function conflictingFormulaChecksums(path: string, asset: string): string {
  return `${escaped(path)} lists different SHA-256 checksums for ${escaped(asset)}. Regenerate SHA256SUMS with one checksum per asset, then run loom release formula again.`;
}

function unsupportedFormulaLicense(license: string): string {
  return `package.json's license, ${escaped(license)}, is an SPDX expression a Homebrew formula cannot state as written. Simplify it to one license, or to licenses joined only by OR or only by AND, then run loom release formula again, or edit the license line of the formula by hand.`;
}

function wroteFormula(path: string): string {
  return `Wrote the Homebrew formula to ${escaped(path)}.\n`;
}

export {
  abandonedVersion,
  answerBrokeOff,
  changedDuringPreparation,
  changedSinceCut,
  checkoutChanged,
  cleanCheckoutRequired,
  commitOutsideCheckout,
  conflictingFormulaChecksums,
  createdRelease,
  createdTag,
  cutFromWorkspace,
  deletedAsset,
  formulaMetadataRequired,
  formulaRepositoryRequired,
  initialNeedsZero,
  integrityMismatch,
  invalidFormulaPath,
  invalidJsonAnswer,
  keptAsset,
  libraryState,
  lockExists,
  lockfileInvalidYaml,
  lockfilePreparationFailed,
  lockfileTimedOut,
  missingFormulaChecksum,
  neverAppeared,
  noChangelogSection,
  noFragments,
  noVersionCommit,
  onRegistry,
  planDecision,
  planHeading,
  outputFolderMissing,
  planNotJson,
  planNotJsonAt,
  planWithoutNotes,
  pnpmMissing,
  provenanceConflict,
  provenanceElsewhere,
  provenanceNotJson,
  provenanceNotOurs,
  provenanceOf,
  provenanceWithoutSource,
  readFromRegistry,
  recorded,
  refusedRequest,
  releaseState,
  releaseWithoutEntries,
  requestTimedOut,
  requestUnreached,
  reusedRelease,
  reusedTag,
  rollbackIncomplete,
  sectionWithoutNotes,
  stableTargetOnly,
  tagAwayFromPublication,
  tagExists,
  tagNamesOther,
  tagObjectMissing,
  tagState,
  tagWithoutProvenance,
  tarballOf,
  targetBelowRelease,
  theAsset,
  theRelease,
  theTag,
  tokenRequired,
  unreleasedPlan,
  unsupportedIntegrity,
  uploadOriginRefused,
  uploadedAsset,
  uploadsDisagree,
  verifiedTarball,
  unsupportedFormulaLicense,
  wroteFormula,
};
