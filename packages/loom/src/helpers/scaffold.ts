import { z } from 'zod';

import { parseManifest } from './build-facts.js';
import { withoutByteOrderMark } from './markdown.js';

/** A JSON object as `package.json` holds it, every key kept in its order. */
const jsonObject = z.record(z.string(), z.unknown());

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

/**
 * Adds one key to a manifest object when it is missing and says whether it did. A key whose parent
 * exists as something other than an object is never added.
 */
function addKey(manifest: Record<string, unknown>, { path, value }: ManifestKey): boolean {
  const [first, second] = path;
  const exists = Object.hasOwn(manifest, first);
  if (second === undefined) {
    if (!exists) {
      manifest[first] = value;
    }
    return !exists;
  }
  const parent = exists ? jsonObject.safeParse(manifest[first]) : undefined;
  if (parent === undefined || (parent.success && !Object.hasOwn(parent.data, second))) {
    manifest[first] = { ...parent?.data, [second]: value };
    return true;
  }
  return false;
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

/** One `package.json` key init writes when it is missing: a top-level key or a key one level down. */
export interface ManifestKey {
  readonly path: readonly [string] | readonly [string, string];
  readonly value: unknown;
}

/** The `package.json` keys a scaffold adds, for an application's name and the running loom version. */
export function scaffoldKeys(name: string, version: string): ManifestKey[] {
  return [
    { path: ['bin'], value: { [name]: 'dist/main.js' } },
    { path: ['scripts', 'build'], value: 'loom build --target node' },
    { path: ['scripts', 'check'], value: 'loom check' },
    { path: ['dependencies', '@loomcli/core'], value: version },
    { path: ['devDependencies', '@loomcli/loom'], value: version },
  ];
}

/**
 * Adds each key a `package.json` source lacks and returns the new source with the dotted path of
 * each key added. A key that exists is never changed, whatever it holds, and a key whose parent
 * exists as something other than an object is left out. A source that gains no key comes back
 * byte-identical. One that gains a key is serialized again with its own indentation, line endings,
 * byte-order mark, and trailing newline, its keys in their order and each new key at the end of its
 * object.
 */
export function addMissingKeys(
  source: string,
  keys: readonly ManifestKey[],
): { added: string[]; text: string } {
  const manifest = parseManifest(source);
  const added: string[] = [];
  for (const key of keys) {
    if (addKey(manifest, key)) {
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
