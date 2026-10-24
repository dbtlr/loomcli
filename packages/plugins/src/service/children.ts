import { isAbsolute } from 'node:path';

import { applicationDirectory } from '@loomcli/core';
import type { Host } from '@loomcli/core';

import { digestOf, observe } from '../installation/disk.js';
import { install, readRecorded, targetRefusals, uninstall } from '../installation/files.js';
import type { Refusal } from '../installation/files.js';
import type { CommittedFile } from '../installation/record.js';
import { singleLineOf } from '../lines.js';
import type { Backend, Service } from './backend.js';
import { launchd } from './launchd.js';
import { lines, refusals } from './messages.js';
import type { Child } from './messages.js';
import { systemd } from './systemd.js';

/** A control character, U+0000 to U+001F or U+007F to U+009F. */
const controlCharacter = /\p{Cc}/u;

/** Whether the text holds a control character, which would write extra directives into the unit. */
function holdsControlCharacter(text: string): boolean {
  return controlCharacter.test(text);
}

/** The unit file's mode whatever the umask, because launchd refuses a plist its group or others can write. */
const unitMode = 0o644;

/** The plugin's file in the installation record, `service.json`. */
const recordName = 'service';

/** What a child reads from its action: the application, the run, and the lanes it writes. */
interface ChildRun {
  readonly name: string;
  readonly description: string | undefined;
  readonly label: string;
  readonly host: Host;
  readonly signal: AbortSignal;
  readonly info: (message: string) => Promise<void>;
  readonly success: (message: string) => Promise<void>;
}

/** What the checks found: the run's service, its backend, its home, and its record directory. */
interface Prepared {
  readonly run: ChildRun;
  readonly service: Service;
  readonly backend: Backend;
  readonly home: string;
  readonly record: string;
}

/** What the module did with the recorded files an install or uninstall no longer lists. */
interface Removals {
  readonly removed: readonly string[];
  readonly kept: readonly string[];
}

/** The backend each supported platform selects. */
const backends: Readonly<Record<string, Backend>> = { darwin: launchd, linux: systemd };

/** The run's user id, or the platform refusal where the process has none. */
function userId(name: string, host: Host): number {
  if (host.uid === undefined) {
    throw refusals.platform(name, host.platform);
  }
  return host.uid;
}

/**
 * The managers' environment: the host's, which on Linux gains `/run/user/<uid>` for an absent
 * `XDG_RUNTIME_DIR`, because `sudo -u` drops it and `systemctl --user` needs it.
 */
function managerEnv(host: Host, uid: number): Host['env'] {
  if (host.platform !== 'linux' || host.env.XDG_RUNTIME_DIR !== undefined) {
    return host.env;
  }
  return { ...host.env, XDG_RUNTIME_DIR: `/run/user/${uid}` };
}

/** The record directory, which an absolute `HOME` always resolves. */
function recordDirectory(run: ChildRun): string {
  const directory = applicationDirectory('installation', run.name, run.host);
  if ('variable' in directory) {
    throw refusals.home(run.name);
  }
  return directory.path;
}

/** The platform's backend, or the refusal of a platform with neither manager. */
function backendOf(run: ChildRun): Backend {
  const backend = backends[run.host.platform];
  if (backend === undefined) {
    throw refusals.platform(run.name, run.host.platform);
  }
  return backend;
}

/** The absolute `HOME` the unit runs from, or the refusal of any other. */
function homeOf(run: ChildRun): string {
  const home = run.host.env.HOME;
  if (home === undefined || !isAbsolute(home)) {
    throw refusals.home(run.name);
  }
  return home;
}

/**
 * The checks every child makes, in order, before it reads or writes anything else: the platform,
 * which selects the backend, and an absolute `HOME`.
 */
function prepare(run: ChildRun): Prepared {
  const { host, label, name, signal } = run;
  const backend = backendOf(run);
  const home = homeOf(run);
  const uid = userId(name, host);
  const manager = { env: managerEnv(host, uid), name, signal };
  const unit = backend.unitPath(label, home, host.env);
  const service = { label, manager, name, uid, unit };
  return { backend, home, record: recordDirectory(run), run, service };
}

/** Whether anything is at the path: a file, a link, a directory, or any other kind. */
function isPresent(path: string): boolean {
  return observe(path).kind !== 'absent';
}

/** The refusal of a build that is not distributed, which `install` alone makes. */
function requireDistributed(run: ChildRun): void {
  const { build } = run.host.release;
  if (build !== 'distributed') {
    throw refusals.build(run.name, build);
  }
}

/** The files the plugin's file records, or the refusal of a damaged or unknown-format file. */
function recordedFiles(prepared: Prepared, child: Child): readonly CommittedFile[] {
  const read = readRecorded({ plugin: recordName, record: prepared.record });
  if (read.status === 'refused') {
    throw refusals.record(prepared.run.name, read.refused.path, child);
  }
  return read.files;
}

/** The sentence one refusal of the unit's path states. */
function refusalOf(run: ChildRun, refusal: Refusal): Error {
  switch (refusal.reason) {
    case 'unrecorded': {
      return refusals.unrecorded(run.name, refusal.path);
    }
    case 'changed': {
      return refusals.changed(run.name, refusal.path);
    }
    case 'damaged':
    case 'unknown-format': {
      return refusals.record(run.name, refusal.path, 'install');
    }
    default: {
      return refusals.irregular(run.name, refusal.path);
    }
  }
}

/** Throws the first refusal, when there is one. */
function refuse(run: ChildRun, refused: readonly Refusal[]): void {
  const [refusal] = refused;
  if (refusal !== undefined) {
    throw refusalOf(run, refusal);
  }
}

/**
 * The unit's text, or the refusal of a value the file cannot hold. The description is read on one
 * line first, as help reads it, so only a path or a character that form keeps is refused.
 */
function renderUnit(prepared: Prepared, words: readonly string[]): string {
  const { run, home } = prepared;
  const description = singleLineOf(run.description) ?? run.name;
  const { program } = run.host;
  if ([...program, description, home].some(holdsControlCharacter)) {
    throw refusals.controlCharacter(run.name);
  }
  return prepared.backend.render({
    description,
    home,
    label: run.label,
    words: [...program, ...words],
  });
}

/** Whether the unit at its path holds the rendered text and the record lists it alone with that digest. */
function isUnchanged(unit: string, text: string, files: readonly CommittedFile[]): boolean {
  const digest = digestOf(text);
  const seen = observe(unit);
  const [only, another] = files;
  const listed = only?.path === unit && only.digest === digest && another === undefined;
  return listed && seen.kind === 'file' && seen.digest === digest;
}

/** States the recorded files the module removed, and those it kept because they changed. */
async function reportRemovals(run: ChildRun, removals: Removals): Promise<void> {
  for (const path of removals.removed) {
    await run.info(lines.removed(path));
  }
  for (const path of removals.kept) {
    await run.info(lines.kept(run.name, path));
  }
}

/** Stops each earlier unit the record lists at a path other than the unit's. */
async function retireEarlier(prepared: Prepared, files: readonly CommittedFile[]): Promise<void> {
  const { backend, service } = prepared;
  for (const file of files.filter(({ path }) => path !== service.unit)) {
    await backend.retire(service, file.path);
  }
}

/**
 * Writes the unit through the installed-files module after stopping each earlier unit the record
 * lists, and states what the module did.
 */
async function writeUnit(prepared: Prepared, text: string, files: readonly CommittedFile[]) {
  const { record, run, service } = prepared;
  await retireEarlier(prepared, files);
  const outcome = install({
    files: [{ content: text, mode: unitMode, path: service.unit }],
    plugin: recordName,
    record,
    signal: run.signal,
  });
  if (outcome.status === 'refused') {
    refuse(run, outcome.refused);
    return;
  }
  await run.info(lines.wrote(service.unit));
  await reportRemovals(run, outcome);
}

/** `install`: the checks and refusals, then the unit written unless unchanged, loaded, and started. */
async function installChild(run: ChildRun, words: readonly string[]): Promise<void> {
  const prepared = prepare(run);
  requireDistributed(run);
  const text = renderUnit(prepared, words);
  const { service } = prepared;
  const files = recordedFiles(prepared, 'install');
  refuse(run, targetRefusals([service.unit], files));
  const unchanged = isUnchanged(service.unit, text, files);
  await (unchanged ? run.info(lines.unchanged(service.unit)) : writeUnit(prepared, text, files));
  await prepared.backend.install(service, !unchanged);
  await run.success(lines.started(run.label));
}

/** The line one recorded file's removal states: removed, kept because it changed, or already gone. */
function removalLine(run: ChildRun, path: string, removals: Removals): string {
  if (removals.removed.includes(path)) {
    return lines.removed(path);
  }
  return removals.kept.includes(path) ? lines.kept(run.name, path) : lines.gone(path);
}

/** Stops every recorded unit, removes the recorded files, and states each one. */
async function removeUnits(prepared: Prepared, files: readonly CommittedFile[]): Promise<void> {
  const { backend, record, run, service } = prepared;
  for (const file of files) {
    await backend.retire(service, file.path);
  }
  const outcome = uninstall({ plugin: recordName, record, signal: run.signal });
  if (outcome.status === 'refused') {
    const [refusal] = outcome.refused;
    throw refusals.record(run.name, refusal?.path ?? record, 'uninstall');
  }
  await backend.afterRemoval(service);
  for (const file of files) {
    await run.info(removalLine(run, file.path, outcome));
  }
}

/** `uninstall`: the checks and refusals, then every recorded unit stopped and its file removed. */
async function uninstallChild(run: ChildRun): Promise<void> {
  const prepared = prepare(run);
  const { unit } = prepared.service;
  const files = recordedFiles(prepared, 'uninstall');
  if (isPresent(unit) && !files.some(({ path }) => path === unit)) {
    throw refusals.unrecordedUninstall(run.name, unit);
  }
  const [recorded] = files;
  await (recorded === undefined
    ? run.success(lines.nothingToRemove(run.label))
    : removeUnits(prepared, files));
}

/** The service a child that needs an installed unit acts on, or the not-installed refusal. */
function installedService(run: ChildRun): Prepared {
  const prepared = prepare(run);
  if (!isPresent(prepared.service.unit)) {
    throw refusals.notInstalled(run.name, run.label);
  }
  return prepared;
}

/** The line each control child states once its call succeeded. */
const controlLines = { restart: lines.restarted, start: lines.started, stop: lines.stopped };

/** `start`, `stop`, and `restart`: the manager's call for an installed unit, then its line. */
async function control(run: ChildRun, verb: keyof typeof controlLines): Promise<void> {
  const { backend, service } = installedService(run);
  await backend[verb](service);
  await run.success(controlLines[verb](run.label));
}

export type { ChildRun, Prepared };
export { control, holdsControlCharacter, installChild, isPresent, prepare, uninstallChild };
