import { safeParse } from 'valibot';

import { withoutByteOrderMark } from './byte-order-mark.js';
import { jsonObject } from './json-object.js';
import { parseManifest } from './manifest.js';
import { checkScript, toolDependencies, toolRanges } from './tooling.js';
import type { Tooling } from './tooling.js';

/**
 * Words that cannot name a `const` in a strict-mode module, which an application's identifier
 * therefore never is.
 */
const reservedWords = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/** A word with its first character in upper case. */
function capitalized(word: string) {
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
}

/** The indentation a JSON document's source uses: its first indented line's, by default 2 spaces. */
function indentation(source: string): string {
  const indent = /^(?<indent>[ \t]+)\S/mu.exec(source)?.groups?.indent;
  if (indent === undefined) {
    return '  ';
  }
  return indent.startsWith('\t') ? '\t' : indent;
}

/** Whether a manifest value is an object that holds the key. */
function holdsKey(value: unknown, key: string): boolean {
  const parsed = safeParse(jsonObject, value);
  return parsed.success && Object.hasOwn(parsed.output, key);
}

/**
 * Adds one key to a manifest object when it is missing and says whether it did. A key whose parent
 * exists as something other than an object is never added.
 */
function addKey(
  manifest: Record<string, unknown>,
  original: Record<string, unknown>,
  { declaredIn = [], path, unlessDeclared, value }: ManifestKey,
): boolean {
  if (unlessDeclared !== undefined && declaresDependency(original, unlessDeclared)) {
    return false;
  }
  const [first, second] = path;
  const exists = Object.hasOwn(manifest, first);
  if (second === undefined) {
    if (!exists) {
      manifest[first] = value;
    }
    return !exists;
  }
  if (declaredIn.some((group) => holdsKey(manifest[group], second))) {
    return false;
  }
  const parent = exists ? safeParse(jsonObject, manifest[first]) : undefined;
  if (parent === undefined || (parent.success && !Object.hasOwn(parent.output, second))) {
    manifest[first] = { ...parent?.output, [second]: value };
    return true;
  }
  return false;
}

/** The `package.json` groups that declare a dependency, any one of which declares it for good. */
const dependencyGroups = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/** Whether a manifest declares the package in any of its dependency fields. */
function declaresDependency(manifest: Record<string, unknown>, name: string): boolean {
  return dependencyGroups.some((group) => holdsKey(manifest[group], name));
}

/** A dependency a scaffold adds to its group unless the package declares it in any group. */
function dependencyKey(group: string, name: string, value: string): ManifestKey {
  return { declaredIn: dependencyGroups, path: [group, name], value };
}

/** What the `typescript` alias of an ESLint scaffold starts with, before the compatibility package's range. */
const typescriptAliasPrefix = 'npm:@typescript/typescript6@';

/**
 * The compiler keys of a scaffold. typescript-eslint supports TypeScript below 6.1 and reads the
 * TypeScript 6 API, which TypeScript 7 does not ship, so an ESLint scaffold aliases `typescript` to
 * the TypeScript 6 compatibility package and gains the compiler itself as `@typescript/native`,
 * which supplies `tsc`. A package that declares its own `typescript` keeps it and gets no second
 * compiler, so an existing ESLint package on TypeScript 7 adds the alias by hand. Both keys go once
 * typescript-eslint supports TypeScript 7.
 */
function compilerKeys({ linter }: Tooling, typescript: string): ManifestKey[] {
  if (linter === 'oxlint') {
    return [dependencyKey('devDependencies', 'typescript', typescript)];
  }
  return [
    dependencyKey(
      'devDependencies',
      'typescript',
      `${typescriptAliasPrefix}${toolRanges['@typescript/typescript6']}`,
    ),
    {
      ...dependencyKey('devDependencies', '@typescript/native', `npm:typescript@${typescript}`),
      unlessDeclared: 'typescript',
    },
  ];
}

/**
 * The test runner a manifest already declares: vitest when any dependency field names it, else Bun
 * when one names `@types/bun`, the package a Bun scaffold declares. Vitest wins when both appear,
 * because a package that declares it runs its tests there.
 */
export function existingRunner(manifest: Record<string, unknown>): Tooling['runner'] | undefined {
  if (declaresDependency(manifest, 'vitest')) {
    return 'vitest';
  }
  return declaresDependency(manifest, '@types/bun') ? 'bun' : undefined;
}

/** The range or alias a manifest declares `typescript` under, in the first field that names it. */
export function declaredTypescript(manifest: Record<string, unknown>): string | undefined {
  for (const group of dependencyGroups) {
    const parsed = safeParse(jsonObject, manifest[group]);
    const range = parsed.success ? parsed.output.typescript : undefined;
    if (typeof range === 'string') {
      return range;
    }
  }
  return undefined;
}

/**
 * Whether a declared `typescript` range is the TypeScript 6 compatibility alias an ESLint scaffold
 * writes, which typescript-eslint can load.
 */
export function isTypescriptAlias(range: string): boolean {
  return range.startsWith(typescriptAliasPrefix);
}

/**
 * Whether a directory's name can name a new package and its Application unchanged. npm's unscoped
 * rule allows lowercase letters, digits, `.`, `-`, and `_`, with no leading `.` or `_`, in at most
 * 214 characters. Core's portable name rule, `@loomcli/core/portable-name`, which core does not
 * export, also refuses a leading `-`. A name passes both, so it opens with a letter or a digit.
 */
export function isNewPackageName(name: string): boolean {
  return name.length <= 214 && /^[\da-z][\da-z._-]*$/u.test(name);
}

/**
 * The identifier the application module exports its Application under: the application's name in
 * camel case, so `my-notes` reads as `myNotes`. Characters an identifier cannot hold separate the
 * words and are dropped. A result that is empty, opens with a digit, or is a reserved word gains the
 * prefix `app`, so `123abc` reads as `app123abc`.
 */
export function applicationIdentifier(name: string): string {
  const words = name.split(/[^\p{ID_Continue}$]+/u).filter((word) => word !== '');
  const joined = words.map((word, index) => (index === 0 ? word : capitalized(word))).join('');
  if (/^[\p{ID_Start}$_]/u.test(joined) && !reservedWords.has(joined)) {
    return joined;
  }
  return `app${capitalized(joined)}`;
}

/**
 * One `package.json` key init writes when it is missing: a top-level key or a key one level down. A
 * key one level down counts as present when any object named in `declaredIn` holds it too. A key
 * with `unlessDeclared` is left out when the package declared that dependency before the run.
 */
export interface ManifestKey {
  readonly declaredIn?: readonly string[];
  readonly path: readonly [string] | readonly [string, string];
  readonly unlessDeclared?: string;
  readonly value: unknown;
}

/** The versions a scaffold pins: the running loom's, and the TypeScript range loom declares. */
export interface ScaffoldVersions {
  readonly loom: string;
  readonly typescript: string;
}

/**
 * The `package.json` keys a scaffold adds, for an application's name, the versions it pins, and the
 * linter and test runner it wires.
 */
export function scaffoldKeys(
  name: string,
  { loom, typescript }: ScaffoldVersions,
  tooling: Tooling,
): ManifestKey[] {
  return [
    { path: ['bin'], value: { [name]: 'dist/main.js' } },
    { path: ['scripts', 'build'], value: 'loom build --target node' },
    { path: ['scripts', 'check'], value: checkScript(tooling) },
    dependencyKey('dependencies', '@loomcli/core', loom),
    dependencyKey('devDependencies', '@loomcli/loom', loom),
    ...compilerKeys(tooling, typescript),
    dependencyKey('devDependencies', '@loomcli/testing', loom),
    dependencyKey('devDependencies', '@loomcli/eslint-plugin', loom),
    ...toolDependencies(tooling).map((tool) =>
      dependencyKey('devDependencies', tool, toolRanges[tool]),
    ),
  ];
}

/**
 * Adds each key a `package.json` source lacks and returns the new source with the dotted path of
 * each key added. A key that exists is never changed, whatever it holds, and a key whose parent
 * exists as something other than an object is left out. A dependency key counts as present when
 * the package declares that dependency in any of `dependencies`, `devDependencies`,
 * `peerDependencies`, or `optionalDependencies`, so a dependency stays in the group that declares it. A source that gains no key comes back
 * byte-identical. One that gains a key is serialized again with its own indentation, line endings,
 * byte-order mark, and trailing newline, its keys in their order and each new key at the end of its
 * object.
 */
export function addMissingKeys(
  source: string,
  keys: readonly ManifestKey[],
): { added: string[]; text: string } {
  // Init reads the package's manifest before it adds a key, so a path relative to the package suffices.
  const manifest = parseManifest(source, 'package.json');
  const original = parseManifest(source, 'package.json');
  const added: string[] = [];
  for (const key of keys) {
    if (addKey(manifest, original, key)) {
      added.push(key.path.join('.'));
    }
  }
  if (added.length === 0) {
    return { added, text: source };
  }
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(manifest, undefined, indentation(source)).replaceAll('\n', newline);
  const mark = source.slice(0, source.length - withoutByteOrderMark(source).length);
  const trailing = /\r?\n$/u.test(source) ? newline : '';
  return { added, text: `${mark}${body}${trailing}` };
}
