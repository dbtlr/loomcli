import { DeclarationError } from '@loomcli/core';
import type { DiagnosticRule } from '@loomcli/core';

import {
  configFileFormat,
  configFilePath,
  configFilePattern,
  configVariableName,
} from '../rules.js';
import { isVariableName } from '../variable-name.js';
import { knownExtensions, readerFormatOf, readerName, readExtensions } from './extensions.js';
import { configIdentity as identity, splitExtension } from './names.js';
import type { ConfigurationReader } from './reading.js';

/** The extensions a brace list may list, whether or not the application passes their reader. */
const listable = new Set(knownExtensions());

/** The characters of glob syntax, which `file` holds only as the whole extension of its name. */
const globSyntax = /[*?[\]{}]/u;

/** A brace list: braces around comma-separated items that hold no other glob syntax. */
const braceList = /^\{(?<items>[^*?[\]{}]*)\}$/u;

/** A path that starts at a root: `/`, `\`, or a drive letter and a colon. */
const rooted = /^(?:[/\\]|[A-Za-z]:)/u;

/** One fault of the `file` setting: its rule and the sentence and correction it reads. */
interface FileFault {
  readonly rule: DiagnosticRule;
  readonly sentence: string;
  readonly correction: string;
}

const notRelative: FileFault = {
  correction: 'Supply a relative path such as .textstat.toml, with no empty, ., or .. segment.',
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
  correction:
    'List only json, jsonc, toml, yaml, or yml in the braces, or use * for every format the application reads.',
  rule: configFilePattern,
  sentence: `Plugin "${identity}" file lists an extension the plugin cannot read.`,
};

/**
 * The fault of a file pattern that names an extension whose format's reader the application does
 * not pass, which names the reader to pass.
 */
function readerMissing(extension: string, reader: string): FileFault {
  return {
    correction: `Pass ${reader}, from @loomcli/plugins/config/${reader}, in formats.`,
    rule: configFileFormat,
    sentence: `Plugin "${identity}" file names ${extension} files, and formats holds no reader for them.`,
  };
}

/** The fault of one `configuration(settings)` call, which rebuilds the call and marks its `file`. */
function fileFault(settings: unknown, { correction, rule, sentence }: FileFault): DeclarationError {
  return new DeclarationError(rule, {
    correction,
    findings: [{ arguments: [settings], call: 'configuration', mark: '0.file' }],
    sentence,
  });
}

/**
 * Whether a path is relative and well formed: nonempty, not rooted, and with every segment, split
 * on `/` and `\`, nonempty and neither `.` nor `..`.
 */
function isRelativePath(path: string): boolean {
  if (path === '' || rooted.test(path)) {
    return false;
  }
  return path.split(/[/\\]/u).every((segment) => !['', '.', '..'].includes(segment));
}

/**
 * The candidates a glob extension names after a stem, or the fault it raises: `*` names every
 * extension the application reads, its readers' and JSON's, and a brace list names the extensions
 * it lists, each at its first position.
 */
function extensionCandidates(
  stem: string,
  extension: string,
  readers: readonly ConfigurationReader[],
): readonly string[] | FileFault {
  if (extension === '*') {
    return readExtensions(readers).map((name) => `${stem}.${name}`);
  }
  const items = braceList.exec(extension)?.groups?.items;
  if (items === undefined) {
    return strayGlob;
  }
  const listed = items.split(',');
  if (!listed.every((name) => listable.has(name))) {
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
function patternCandidates(
  path: string,
  readers: readonly ConfigurationReader[],
): readonly string[] | FileFault {
  if (!globSyntax.test(path)) {
    return [path];
  }
  const split = splitExtension(path);
  if (split === undefined || globSyntax.test(split.stem)) {
    return strayGlob;
  }
  return extensionCandidates(split.stem, split.extension, readers);
}

/**
 * The fault of the first candidate whose extension names a format the application passes no
 * reader for, or `undefined` when the readers cover every candidate. A literal name meets it as a
 * brace list does, since its extension locks its format.
 */
function unreadCandidate(
  candidates: readonly string[],
  readers: readonly ConfigurationReader[],
): FileFault | undefined {
  for (const candidate of candidates) {
    const extension = splitExtension(candidate)?.extension;
    const format = extension === undefined ? undefined : readerFormatOf(extension);
    if (
      extension !== undefined &&
      format !== undefined &&
      !readers.some((reader) => reader.format === format)
    ) {
      return readerMissing(extension, readerName(format));
    }
  }
  return undefined;
}

/**
 * The candidates a relative path names, or the fault of the pattern rule, or else of the first
 * candidate whose format has no reader among the readers passed.
 */
function judgedCandidates(
  path: string,
  readers: readonly ConfigurationReader[],
): readonly string[] | FileFault {
  const candidates = patternCandidates(path, readers);
  return 'rule' in candidates ? candidates : (unreadCandidate(candidates, readers) ?? candidates);
}

/**
 * The candidates the settings' `file` names, judged at the call, or `undefined` when the settings
 * name no file and the source derives the default. `readers` are the ones `formats` passes. `file`
 * is read once. The path rule comes first, then the pattern rule, then the rule that each format
 * the candidates name has its reader in `formats`, and each fault marks `file`.
 */
export function fileCandidates(
  settings: { readonly file?: string } | undefined,
  readers: readonly ConfigurationReader[],
): readonly string[] | undefined {
  const file = settings?.file;
  if (file === undefined) {
    return undefined;
  }
  if (!isRelativePath(file)) {
    throw fileFault(settings, notRelative);
  }
  const candidates = judgedCandidates(file, readers);
  if ('rule' in candidates) {
    throw fileFault(settings, candidates);
  }
  return candidates;
}

/** The variable the settings' `env` names, or `undefined` for none. A name of another form is a fault, marking `env`. */
export function envVariable(settings: { readonly env?: string } | undefined): string | undefined {
  const env = settings?.env;
  if (env === undefined || isVariableName(env)) {
    return env;
  }
  throw new DeclarationError(configVariableName, {
    correction:
      'Name a variable such as COLLECTOR_CONFIG: a letter or an underscore, then letters, digits, or underscores.',
    findings: [{ arguments: [settings], call: 'configuration', mark: '0.env' }],
    sentence: `Plugin "${identity}" env is not a variable name.`,
  });
}
