import { DeclarationError } from '@loomcli/core';
import type { DiagnosticRule } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { configFilePath, configFilePattern } from '../rules.js';
import { splitExtension } from './names.js';

const identity = `${Package.name}/config`;

/** The extensions a pattern may name, in the order `*` tries them. */
const readable = ['toml', 'yaml', 'yml', 'json'];
const readableSet = new Set(readable);

/** The characters of glob syntax, which `file` holds only as the whole extension of its name. */
const globSyntax = /[*?[\]{}]/u;

/** A brace list: braces around comma-separated items that hold no other glob syntax. */
const braceList = /^\{(?<items>[^*?[\]{}]*)\}$/u;

/** A path that starts at a root: `/`, `\`, or a drive letter and a colon. */
const rooted = /^(?:[/\\]|[A-Za-z]:)/u;

const controlCharacter = /\p{Cc}/u;

/** One fault of the `file` setting: its rule and the sentence and correction it reads. */
interface FileFault {
  readonly rule: DiagnosticRule;
  readonly sentence: string;
  readonly correction: string;
}

const notRelative: FileFault = {
  correction:
    'Supply a relative path such as .textstat.toml, with no control character and no empty, ., or .. segment.',
  rule: configFilePath,
  sentence: `Plugin "${identity}" file is not a relative path.`,
};

const strayGlob: FileFault = {
  correction:
    'Write the name literally, and use * or a brace list only as the whole text after its last dot.',
  rule: configFilePattern,
  sentence: `Plugin "${identity}" file holds glob syntax other than an extension of * or a brace list.`,
};

const unreadableExtension: FileFault = {
  correction: 'List only json, toml, yaml, or yml in the braces, or use * for any of them.',
  rule: configFilePattern,
  sentence: `Plugin "${identity}" file lists an extension the plugin cannot read.`,
};

/** The fault of one `config(settings)` call, which rebuilds the call and marks its `file`. */
function fileFault(settings: unknown, { correction, rule, sentence }: FileFault): DeclarationError {
  return new DeclarationError(rule, {
    correction,
    findings: [{ arguments: [settings], call: 'config', mark: '0.file' }],
    sentence,
  });
}

/**
 * Whether a path is relative and well formed: nonempty, with no control character, not rooted,
 * and with every segment, split on `/` and `\`, nonempty and neither `.` nor `..`.
 */
function isRelativePath(path: string): boolean {
  if (path === '' || controlCharacter.test(path) || rooted.test(path)) {
    return false;
  }
  return path.split(/[/\\]/u).every((segment) => !['', '.', '..'].includes(segment));
}

/**
 * The candidates a glob extension names after a stem, or the fault it raises: `*` names every
 * readable extension, and a brace list names the extensions it lists, each at its first position.
 */
function extensionCandidates(stem: string, extension: string): readonly string[] | FileFault {
  if (extension === '*') {
    return readable.map((name) => `${stem}.${name}`);
  }
  const items = braceList.exec(extension)?.groups?.items;
  if (items === undefined) {
    return strayGlob;
  }
  const listed = items.split(',');
  if (!listed.every((name) => readableSet.has(name))) {
    return unreadableExtension;
  }
  return [...new Set(listed)].map((name) => `${stem}.${name}`);
}

/**
 * The candidates a well-formed relative path names, in the order the plugin tries them, or the
 * fault its glob syntax raises. A path with no glob syntax is its own one candidate. Otherwise the
 * glob syntax is the whole extension of the last segment, the text after its last `.` unless that
 * `.` starts the name.
 */
function patternCandidates(path: string): readonly string[] | FileFault {
  if (!globSyntax.test(path)) {
    return [path];
  }
  const split = splitExtension(path);
  if (split === undefined || globSyntax.test(split.stem)) {
    return strayGlob;
  }
  return extensionCandidates(split.stem, split.extension);
}

/**
 * The candidates the settings' `file` names, judged at the call, or `undefined` when the settings
 * name no file and the source derives the default. `file` is read once. The path rule comes first,
 * then the pattern rule, and each fault marks `file`.
 */
export function fileCandidates(
  settings: { readonly file?: string } | undefined,
): readonly string[] | undefined {
  const file: unknown = settings?.file;
  if (file === undefined) {
    return undefined;
  }
  if (typeof file !== 'string' || !isRelativePath(file)) {
    throw fileFault(settings, notRelative);
  }
  const candidates = patternCandidates(file);
  if ('rule' in candidates) {
    throw fileFault(settings, candidates);
  }
  return candidates;
}
