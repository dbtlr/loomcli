// @module-tag docs
/*
 * The reader every package's voice test shares. It reads a package's message modules and scans its
 * other source files. Each of the four checks shared by all packages reports a bad sentence
 * written for it:
 *
 * - banned words, a word the voice page's table bars, in any literal of a message module;
 * - escaping, an interpolation that is not an escaping helper, a message function, or a number;
 * - outside text, a read of an error's `message`, `stack`, or `cause` in any source file, a message
 *   module or the code that calls one;
 * - gathering, a literal sentence handed to a failure constructor, an out call, or a log call's
 *   message template outside one.
 *
 * The localization checks also read sentence exports, registry entries, and value imports from
 * message modules outside phrase makers.
 *
 * A known exception is pinned per check and per file by its source text and its count of sites, and
 * both an unpinned site and a stale pin are reported.
 */
import { expect, test } from 'vite-plus/test';

import {
  bannedWordsOf,
  readBannedWords,
  unpinnedSites,
  voiceSites,
} from '../../../scripts/test-voice.js';
import type { VoiceSinks } from '../../../scripts/test-voice.js';

/** The sites one set of files holds, with `presentation` as the only banned word. */
function sitesOf(files: Record<string, string>, sinks?: VoiceSinks) {
  return voiceSites(new Map(Object.entries(files)), {
    banned: ['presentation'],
    ...(sinks ? { sinks } : {}),
  });
}

/** The text of every site one check reports over a single message module. */
function moduleSites(check: string, source: string): string[] {
  return sitesOf({ 'inputs/messages.ts': source })
    .filter((site) => site.check === check)
    .map((site) => site.text);
}

/** The text of every gathering site over a single source file that is not a message module. */
function gathered(source: string, sinks?: VoiceSinks): string[] {
  return sitesOf({ 'inputs/validation.ts': source }, sinks)
    .filter((site) => site.check === 'gathering')
    .map((site) => site.text);
}

/** The text of every outside-text site over a single source file that is not a message module. */
function readOutside(source: string): string[] {
  return sitesOf({ 'inputs/validation.ts': source })
    .filter((site) => site.check === 'outside-text')
    .map((site) => site.text);
}

test('the banned words are the first column of the table under the banned-words heading', () => {
  const page = [
    '## Failure message voice',
    '',
    '### Banned words',
    '',
    'Prose before the table.',
    '',
    '| Do not write | Write |',
    '| --- | --- |',
    '| `presentation` | view, formatter, or request, whichever is meant |',
    '| `renderer` | view |',
    '',
    '### Where messages live',
    '',
    '| Do not write | Write |',
    '| --- | --- |',
    '| `later` | never read |',
  ].join('\n');
  expect(bannedWordsOf(page)).toEqual(['presentation', 'renderer']);
});

test('the voice page lists presentation as its banned word', async () => {
  await expect(readBannedWords()).resolves.toEqual(['presentation']);
});

test('a banned word is reported at the start of a word in any case, in strings and templates', () => {
  const source = [
    "export const first = 'The Presentations failed.';",
    'export function second(count: number): string {',
    '  return `${String(count)} presentational views failed.`;',
    '}',
    "export const third = 'A representation is fine.';",
  ].join('\n');
  expect(moduleSites('banned-words', source)).toEqual([
    "'The Presentations failed.'",
    '`${String(count)} presentational views failed.`',
  ]);
});

test('a banned word in a comment or an identifier is not a sentence', () => {
  const source = [
    '/** The presentation of a missing value. */',
    '// presentation',
    "export const presentation = 'A value is missing.';",
  ].join('\n');
  expect(moduleSites('banned-words', source)).toEqual([]);
});

test('an interpolation that repeats a string unescaped is reported', () => {
  const source = [
    "import { quoted } from '../failures/messages.js';",
    'export function unknown(name: string): string {',
    '  return `Unknown command "${name}". Supply ${quoted(name)}.`;',
    '}',
  ].join('\n');
  expect(moduleSites('escaping', source)).toEqual(['${name}']);
});

test('an escaping helper, a message function, a number, and a literal each pass', () => {
  const source = [
    "import { quoted } from '../failures/messages.js';",
    "import { routedSentence } from '../failures/messages.js';",
    "import { escapeControlCharacters } from '../support/controls.js';",
    'const shown = escapeControlCharacters;',
    'function plural(count: number): string {',
    "  return count === 1 ? 'value' : 'values';",
    '}',
    'export const declared = (command: readonly string[], count: number): string =>',
    '  `${routedSentence(command)} takes ${count} ${plural(count)}, or ${String(count)}.`;',
    'export function nested(name: string, path: string, count: number): string {',
    "  return `${quoted(name)}${path === '' ? '' : ` at ${shown(path)}`}${count > 1 ? 's' : ''}.`;",
    '}',
    'export function grouped({ max, min }: { readonly max: number; min: number }): string {',
    '  return `From ${String(min)} through ${max}.`;',
    '}',
  ].join('\n');
  expect(moduleSites('escaping', source)).toEqual([]);
});

test("a template inside an escaping helper's arguments is escaped whole", () => {
  const source = [
    'export function attached(spelling: string): string {',
    '  return `Attach it as ${quoted(`${spelling}=<value>`)}, not ${plural(`${spelling}s`)}.`;',
    '}',
    'function plural(text: string): string {',
    '  return text;',
    '}',
  ].join('\n');
  expect(moduleSites('escaping', source)).toEqual(['${spelling}']);
});

test('a template handed straight to an escaping helper is escaped whole, and one beside it is not', () => {
  const source = [
    "import { quoted } from '../failures/messages.js';",
    'export function direct(name: string): string {',
    '  return quoted(`a ${name}`);',
    '}',
    'export function beside(name: string): string {',
    "  return [quoted(`b ${name}`), `c ${name}`].join(' ');",
    '}',
  ].join('\n');
  expect(moduleSites('escaping', source)).toEqual(['${name}']);
});

test('a banned word in a literal nested in an interpolation is reported', () => {
  const source = [
    'export function counted(count: number): string {',
    "  return `${count > 1 ? 'presentations' : 'one'} failed.`;",
    '}',
  ].join('\n');
  expect(moduleSites('banned-words', source)).toEqual(["'presentations'"]);
});

test('a name bound to String is no escaping helper and no message function', () => {
  const source = [
    'const shown = String;',
    'export function named(name: string): string {',
    '  return `Read ${shown(name)}.`;',
    '}',
  ].join('\n');
  expect(moduleSites('escaping', source)).toEqual(['${shown(name)}']);
});

test('a destructured member its inline type declares as a string is no number', () => {
  const source = [
    'export const named = ({ name }: { name: string }): string => `Read ${name}.`;',
  ].join('\n');
  expect(moduleSites('escaping', source)).toEqual(['${name}']);
});

test("a conditional's branches are read by the rule, and its condition repeats nothing", () => {
  const source = [
    'export function either(name: string, count: number): string {',
    "  return `${count > 1 ? name : 'none'} and ${name === '' ? 'empty' : name.trim()}.`;",
    '}',
  ].join('\n');
  expect(moduleSites('escaping', source)).toEqual([
    "${count > 1 ? name : 'none'}",
    "${name === '' ? 'empty' : name.trim()}",
  ]);
});

test("a style's escape passes only around an escaping helper", () => {
  const source = [
    "import { escapeControlCharacters } from '../support/controls.js';",
    'export function warned(style: { escape(text: string): string }, path: string): string {',
    '  return `File ${style.escape(escapeControlCharacters(path))} and ${style.escape(path)}.`;',
    '}',
  ].join('\n');
  expect(moduleSites('escaping', source)).toEqual(['${style.escape(path)}']);
});

test('a number is a parameter declared as a number by the function that holds the template', () => {
  const source = [
    'export function counted(count: number | undefined, label: string): string {',
    '  const total = 3;',
    '  return `${count} and ${String(label)} and ${total}.`;',
    '}',
  ].join('\n');
  expect(moduleSites('escaping', source)).toEqual(['${count}', '${String(label)}', '${total}']);
});

test("a message module that reads an error's message, stack, or cause is reported", () => {
  const source = [
    'export function failed(error: Error, issue: { message: string }): string {',
    '  return `It failed: ${error.message} ${error?.stack} ${error["cause"]}.`;',
    '}',
    "export const shape = { message: 'A key, not a read.' };",
  ].join('\n');
  expect(moduleSites('outside-text', source)).toEqual([
    'error.message',
    'error?.stack',
    'error["cause"]',
  ]);
});

test("a caller outside a message module that passes an error's text into a message function is reported", () => {
  const source = [
    "import { cannotRead } from './messages.js';",
    'export function read(path: string, error: Error) {',
    '  throw new InputError(cannotRead(path, error.message), [], { cause: error });',
    '}',
    'export function reason(error?: Error): string {',
    "  return `${error?.stack ?? ''}${String(error?.['cause'])}`;",
    '}',
  ].join('\n');
  expect(readOutside(source)).toEqual(['error.message', 'error?.stack', "['cause']"]);
});

test('a bracket reads a member only after a value, so an array of the names reads nothing', () => {
  const source = [
    "const keys = ['message'];",
    "const named = pick(shape, ['cause'], ['stack']);",
    "export const read = (error: Error) => [error['message'], call()['stack'], keys[0]];",
  ].join('\n');
  expect(readOutside(source)).toEqual(["error['message']", "['stack']"]);
});

test("a caller's read of an error's text passes once a pin names its text, its file, and its count", () => {
  const sites = sitesOf({
    'inputs/validation.ts': [
      'export function relay(error: Error, other: Error) {',
      '  return [relayed(error.message), relayed(other.message), relayed(error.message)];',
      '}',
    ].join('\n'),
  });
  const reason = "The program's own report, which the sentence relays by design.";
  expect(unpinnedSites(sites, {})).toEqual([
    'outside-text inputs/validation.ts: error.message has 2 sites and no pin.',
    'outside-text inputs/validation.ts: other.message has 1 site and no pin.',
  ]);
  expect(
    unpinnedSites(sites, {
      'outside-text': {
        'inputs/validation.ts': {
          'error.message': { reason, sites: 2 },
          'other.message': { reason, sites: 1 },
        },
      },
    }),
  ).toEqual([]);
});

test('an assignment to a member named message, stack, or cause writes it, so no check reports it', () => {
  const source = [
    'export class ReadError extends Error {',
    '  constructor(cause: unknown) {',
    '    super();',
    '    this.cause = cause;',
    "    this['stack'] = undefined;",
    '  }',
    '}',
    "export const same = (failure: Error) => failure.message === 'A comparison reads it.';",
  ].join('\n');
  expect(sitesOf({ 'inputs/validation.ts': source })).toEqual([
    { check: 'outside-text', file: 'inputs/validation.ts', text: 'failure.message' },
  ]);
  expect(
    sitesOf({ 'inputs/messages.ts': 'export const reset = (e: Error) => { e.cause = 1; };' }),
  ).toEqual([]);
});

test('a division or a pattern in a message module is refused', () => {
  expect(() => sitesOf({ 'inputs/messages.ts': 'export const half = 4 / 2;' })).toThrow(
    'inputs/messages.ts: a message module holds no division and no pattern, at offset 22.',
  );
});

test('a literal sentence handed to a failure constructor outside a message module is reported', () => {
  const source = [
    "import { InputError } from '../failures/errors.js';",
    'export function fail(name: string, problems: never[]) {',
    '  throw new InputError(`Option ${name} is invalid.`, problems);',
    '}',
  ].join('\n');
  expect(gathered(source)).toEqual(['`Option ${name} is invalid.`']);
});

test("a failure class's super call and a failure's message assignment are failure constructors", () => {
  const source = [
    'class NotFoundError extends UsageError {',
    '  constructor(found: boolean) {',
    "    super(found ? 'The entry is gone. Restore it.' : missing());",
    '  }',
    '}',
    'class Reader extends Base {',
    '  constructor() {',
    "    super('A reader, not a failure.');",
    '  }',
    '}',
    'export function renamed(failure: Error) {',
    "  failure.message = 'The entry moved. Supply its new name.';",
    "  return failure.message === 'A comparison, not an assignment.';",
    '}',
  ].join('\n');
  expect(gathered(source)).toEqual([
    "'The entry is gone. Restore it.'",
    "'The entry moved. Supply its new name.'",
  ]);
});

test('an out call is a sink on any receiver but a style and the log, whose own check follows', () => {
  const source = [
    'export async function run(out: Out, style: Style, log: Log, headingStyle: Style) {',
    "  await out.warn('The cache is stale. Run refresh.');",
    '  await context.out.debug(`Read ${String(1)} file.`);',
    "  out.fatal('The registry is down. Try again later.');",
    "  style.error('A style, not a line.');",
    "  headingStyle.info('A style, not a line.');",
    '  log.error(readFailed(1));',
    '}',
  ].join('\n');
  expect(gathered(source)).toEqual([
    "'The cache is stale. Run refresh.'",
    '`Read ${String(1)} file.`',
    "'The registry is down. Try again later.'",
  ]);
});

test('a log call whose template is a literal sentence is reported, on any receiver', () => {
  const source = [
    'export function run(log: Log, context: Context) {',
    "  log.debug('Read the file {path}.', { path });",
    "  context.log.info('Wrote the cache {path}.');",
    "  log.with({ run: 1 }).warn('Retry the call {attempt}.', { attempt });",
    '  context.log.with({ a: 1 }).with({ b: 2 }).trace(`Read ${String(1)} file.`);',
    "  log.debug('single');",
    '}',
  ].join('\n');
  expect(gathered(source)).toEqual([
    "'Read the file {path}.'",
    "'Wrote the cache {path}.'",
    "'Retry the call {attempt}.'",
    '`Read ${String(1)} file.`',
  ]);
});

test('a log call whose template comes from a message module passes', () => {
  const source = [
    "import { fileRead, retrying } from './messages.js';",
    'export function run(log: Log) {',
    '  log.debug(fileRead(path), { path });',
    '  log.with({ run: 1 }).warn(retrying, { attempt: 1 });',
    '}',
  ].join('\n');
  expect(gathered(source)).toEqual([]);
});

test('a log call whose template is a same-file const holding a literal sentence is reported', () => {
  const source = [
    "const closeFailed = 'A close failed.';",
    'export function run(log: Log) {',
    '  log.error(closeFailed, { provider });',
    '}',
  ].join('\n');
  expect(gathered(source)).toEqual(["'A close failed.'"]);
  const files = new Map([['plugins/providers.ts', source]]);
  expect(unpinnedSites(voiceSites(files, { banned: ['presentation'] }), {})).toEqual([
    "gathering plugins/providers.ts: 'A close failed.' has 1 site and no pin.",
  ]);
});

test('a log call whose template is imported, or a const that is not a literal sentence, passes', () => {
  const source = [
    "import { imported } from './messages.js';",
    "const word = 'single';",
    "const built = phrase('closeFailed');",
    'export function run(log: Log) {',
    '  log.error(imported);',
    '  log.error(word);',
    '  log.error(built);',
    '}',
  ].join('\n');
  expect(gathered(source)).toEqual([]);
});

test('pinning an inline log template makes it pass, and an unused pin is reported', () => {
  const files = new Map([['inputs/validation.ts', "log.debug('Read the file {path}.');"]]);
  const sites = voiceSites(files, { banned: ['presentation'] });
  const pin = { reason: 'It is right as written.', sites: 1 };
  expect(
    unpinnedSites(sites, {
      gathering: { 'inputs/validation.ts': { "'Read the file {path}.'": pin } },
    }),
  ).toEqual([]);
  expect(unpinnedSites(sites, {})).toEqual([
    "gathering inputs/validation.ts: 'Read the file {path}.' has 1 site and no pin.",
  ]);
});

test('a literal sentence handed to print, info, success, error, or trace is reported', () => {
  const source = [
    'export function run(out: Out) {',
    "  out.print('The plan is ready. Run apply.');",
    "  out.info('The cache is warm. Nothing to do.');",
    "  out.success('The release is cut. Push its tag.');",
    "  out.error('The tag is taken. Choose another.');",
    "  out.trace('Read the lockfile. It is current.');",
    '}',
  ].join('\n');
  expect(gathered(source)).toEqual([
    "'The plan is ready. Run apply.'",
    "'The cache is warm. Nothing to do.'",
    "'The release is cut. Push its tag.'",
    "'The tag is taken. Choose another.'",
    "'Read the lockfile. It is current.'",
  ]);
});

test('a template whose sentence is held only in a literal inside its interpolation is read', () => {
  const source = [
    'export function fail(missing: boolean) {',
    "  throw new InputError(`${missing ? 'The value is missing.' : 'Bad.'}`, []);",
    '}',
  ].join('\n');
  expect(gathered(source)).toEqual(["`${missing ? 'The value is missing.' : 'Bad.'}`"]);
});

test('a literal sentence handed to a named wrapper call, or returned to a named call, is reported', () => {
  const source = [
    "throw fatal('The update failed. Try again.', cause);",
    "throw conflict('channel', 'The channel conflicts. Pick one.', issue);",
    "run.line('Wrote the file. Commit it.');",
    "other.line('A line of another receiver.');",
    "line('A plain call, not the member.');",
    'await report({ out, signal }, async () => {',
    "  return done ? 'The check passed. Nothing to fix.' : summary(count);",
    '});',
    "await other(async () => { return 'A call no sink names.'; });",
  ].join('\n');
  expect(gathered(source)).toEqual([]);
  expect(
    gathered(source, { calls: ['conflict', 'fatal', 'run.line'], returns: ['report'] }),
  ).toEqual([
    "'The update failed. Try again.'",
    "'The channel conflicts. Pick one.'",
    "'Wrote the file. Commit it.'",
    "'The check passed. Nothing to fix.'",
  ]);
});

test('a concise arrow body in a call a returns sink names is read as a returned sentence', () => {
  const source = [
    "await report({ out, signal }, () => 'Checked the fragments now.');",
    'await report({ out, signal }, () => summary(count));',
    "await other(() => 'A call no sink names.');",
  ].join('\n');
  expect(gathered(source)).toEqual([]);
  expect(gathered(source, { returns: ['report'] })).toEqual(["'Checked the fragments now.'"]);
});

test("a concise arrow nested in a returns sink call is read only when it is the call's own argument", () => {
  const source = [
    "await report({ out, signal }, items.filter((item) => item === 'two words'));",
    "await report({ out, signal }, async () => names.map((name) => name === 'other words'));",
    "await report({ out, signal }, () => 'Checked the fragments now.');",
  ].join('\n');
  expect(gathered(source, { returns: ['report'] })).toEqual(["'Checked the fragments now.'"]);
});

test('a function whose return type is an object type is read by its body, not by the type', () => {
  const source = [
    "function f(): { a: string } { return 'Two words here.'; }",
    "function other(): { a: string } { return 'A function no sink names.'; }",
  ].join('\n');
  expect(gathered(source, { functions: ['f'] })).toEqual(["'Two words here.'"]);
});

test('a literal returned from a function a functions sink names is reported, in either form', () => {
  const source = [
    'function cutSummary(cut: Cut): string {',
    "  if (cut.empty) { return 'Cut no version for this package.'; }",
    '  return summary(cut);',
    '}',
    "const renderPlan = (plan: Plan) => 'Planned nothing to release.';",
    "const recordRelease = async (request: Request): Promise<string> => { return 'Recorded the release now.'; };",
    "function other(): string { return 'A function no sink names.'; }",
    "const call = cutSummary(cut) + 'A call is not a declaration.';",
  ].join('\n');
  expect(gathered(source)).toEqual([]);
  expect(gathered(source, { functions: ['cutSummary', 'renderPlan', 'recordRelease'] })).toEqual([
    "'Cut no version for this package.'",
    "'Planned nothing to release.'",
    "'Recorded the release now.'",
  ]);
});

test('a concise arrow nested in brackets in a named function body is read', () => {
  const source = [
    'function renderPlan(plan: Plan): string {',
    '  const lines = [',
    '    heading(plan),',
    '    ...plan.libraries.map((library) => `Library ${quoted(library.name)} is planned.`),',
    '  ];',
    "  return lines.join(', ');",
    '}',
  ].join('\n');
  expect(gathered(source, { functions: ['renderPlan'] })).toEqual([
    '`Library ${quoted(library.name)} is planned.`',
  ]);
});

test('a table without the Do not write and Write columns is refused as the banned words', () => {
  const page = [
    '## Voice',
    '',
    '### Banned words',
    '',
    '| Word | Meaning |',
    '| --- | --- |',
    '| `later` | never |',
  ].join('\n');
  expect(() => bannedWordsOf(page)).toThrow('has no "Do not write" and "Write" columns');
});

test('a message assigned to a bare name is not a sentence, and one assigned to a member is', () => {
  const source = [
    "const message = 'A local name, not an error. Nothing is raised.';",
    "failure.message = 'The failure says this. Fix it.';",
  ].join('\n');
  expect(gathered(source)).toEqual(["'The failure says this. Fix it.'"]);
});

test('a sink inside an interpolation of a template is read', () => {
  const source = "const text = `${run.line('A line inside a template. Fix it.')}`;";
  expect(gathered(source, { calls: ['run.line'] })).toEqual([
    "'A line inside a template. Fix it.'",
  ]);
});

test('a literal inside an object argument, a nested call, or a comment is not handed to the sink', () => {
  const source = [
    'export function declare(rule: Rule, word: string) {',
    "  throw new DeclarationError(rule, { correction: 'Name each option once.' });",
    '}',
    "export const insecure = () => new RequestError('insecure', url);",
    "export const wrapped = () => new InputError(sentence('Option is bad.'), []);",
    '/**',
    " * throw new InputError('A doc comment example.', []);",
    ' */',
    "// out.warn('A comment line.');",
    "export const builtin = () => new TypeError('A defect core never shows.');",
  ].join('\n');
  expect(gathered(source)).toEqual([]);
});

test('a pattern and a division outside a message module are read by the token before them', () => {
  const source = [
    'const ratio = width / 2;',
    "const pattern = /['`]/u;",
    "export const fail = () => new InputError('The ratio is wrong. Supply another.', []);",
  ].join('\n');
  expect(gathered(source)).toEqual(["'The ratio is wrong. Supply another.'"]);
});

test.each(['++', '--'])('a division after a postfix %s hides no later sentence', (operator) => {
  const source = [
    `const share = count${operator} / 2;`,
    "export const fail = () => new InputError('The share is wrong. Supply another.', []);",
    'const rest = total / 2;',
  ].join('\n');
  expect(gathered(source)).toEqual(["'The share is wrong. Supply another.'"]);
});

test("a package's own sinks name its calls, assignments, properties, and plain error classes", () => {
  const source = [
    "const reply = rpcError(-32602, 'The tool takes no such argument.');",
    "issue = 'The saved answer is not UTF-8 text. Save it as UTF-8.';",
    "export const code = issueCode('text-min', { message: () => 'Expected more text here.' });",
    "throw new Error('The release has no changelog. Run loom changelog.');",
  ].join('\n');
  expect(gathered(source)).toEqual([]);
  expect(
    gathered(source, {
      assignments: ['issue'],
      calls: ['rpcError'],
      classes: ['Error'],
      properties: ['message'],
    }),
  ).toEqual([
    "'The tool takes no such argument.'",
    "'The saved answer is not UTF-8 text. Save it as UTF-8.'",
    "'Expected more text here.'",
    "'The release has no changelog. Run loom changelog.'",
  ]);
});

test('a site no pin covers, a pin whose count differs, and a pin that covers no site are reported', () => {
  const sites = sitesOf({
    'config/messages.ts': [
      'export function first(name: string): string {',
      '  return `Read ${name}, then ${name}.`;',
      '}',
      'export function second(path: string): string {',
      '  return `File ${path}.`;',
      '}',
    ].join('\n'),
    'inputs/messages.ts': 'export const fine = (name: string): string => `Hello ${name}.`;',
  });
  const reason = 'The name is a declared identifier, which holds no control character.';
  expect(
    unpinnedSites(sites, {
      escaping: {
        'config/messages.ts': {
          '${name}': { reason, sites: 1 },
          '${unused}': { reason, sites: 1 },
        },
        'inputs/messages.ts': { '${name}': { reason, sites: 1 } },
      },
    }),
  ).toEqual([
    'escaping config/messages.ts: ${name} has 2 sites and its pin names 1.',
    'escaping config/messages.ts: ${path} has 1 site and no pin.',
    'escaping config/messages.ts: ${unused} has 0 sites and its pin names 1.',
  ]);
});

test('a wording module is read as a message module, so its interpolations are held to rule 5', () => {
  const sites = sitesOf({
    'inputs/wording.ts': 'function subject(name: string): string { return `Option ${name}`; }',
  });
  expect(sites).toEqual([{ check: 'escaping', file: 'inputs/wording.ts', text: '${name}' }]);
});

test('a sentence a message module imports from a wording module is a message function', () => {
  const sites = sitesOf({
    'inputs/messages.ts': [
      "import { subject } from './wording.js';",
      'function missing(name: string): string { return `${subject(name)} is required.`; }',
      'export { missing };',
    ].join('\n'),
  });
  expect(sites).toEqual([]);
});

/** The sites of the localization checks over one package's files. */
function localizationSites(files: Record<string, string>) {
  return voiceSites(new Map(Object.entries(files)), {
    banned: ['presentation'],
    registry: 'localization/registry.ts',
  }).filter(
    (site) =>
      site.check === 'export-shape' || site.check === 'message-import' || site.check === 'registry',
  );
}

/** A registry that names `inputs/messages.ts` under its key. */
const registry = "interface Modules { readonly inputs: typeof import('../inputs/messages.js'); }";

test.each([
  ["import { fixed } from './messages.js';", "import { fixed } from './messages.js';"],
  ["import * as sentences from './messages.js';", "import * as sentences from './messages.js';"],
  ["import fixed from './messages.js';", "import fixed from './messages.js';"],
  [
    "import { type Member, fixed } from './messages.js';",
    "import { type Member, fixed } from './messages.js';",
  ],
  ["import './messages.js';", "import './messages.js';"],
  ["export { fixed } from './messages.js';", "export { fixed } from './messages.js';"],
  ["export * from './messages.js';", "export * from './messages.js';"],
  ["const load = () => import('./messages.js');", "import('./messages.js')"],
  ['const load = () => import(`./messages.js`);', 'import(`./messages.js`)'],
])('a direct message import is reported in %s', (source, text) => {
  expect(
    localizationSites({
      'inputs/messages.ts': "export const fixed = 'Use a value.';",
      'inputs/reader.ts': source,
      'localization/registry.ts': registry,
    }),
  ).toEqual([{ check: 'message-import', file: 'inputs/reader.ts', text }]);
});

test('a joined package can reference message types and load message values in phrases.ts', () => {
  expect(
    localizationSites({
      'inputs/messages.ts': "export const fixed = 'Use a value.';",
      'inputs/phrases.ts': "import * as sentences from './messages.js';",
      'inputs/types.ts': [
        "import type * as sentences from './messages.js';",
        "import { type Member, type Other as Renamed } from './messages.js';",
        "export type * from './messages.js';",
        "export { type Member } from './messages.js';",
        "type Module = typeof import('./messages.js');",
      ].join('\n'),
      'localization/registry.ts': registry,
    }),
  ).toEqual([]);
});

test('a package without a registry can import message values directly', () => {
  expect(sitesOf({ 'inputs/reader.ts': "import { fixed } from './messages.js';" })).toEqual([]);
});

test('a message import is pinned by its source text, file, and site count', () => {
  const source = "import('./messages.js')";
  const file = 'inputs/reader.ts';
  const sites = localizationSites({
    'inputs/messages.ts': "export const fixed = 'Use a value.';",
    'inputs/reader.ts': `${source};\n${source};`,
    'localization/registry.ts': registry,
  });
  expect(
    unpinnedSites(sites, {
      'message-import': { [file]: { [source]: { reason: 'Fixture for pinning.', sites: 2 } } },
    }),
  ).toEqual([]);
});

test('with a registry, every export of a message module is a string constant or a string function', () => {
  const module = [
    "import { quoted } from '../failures/wording.js';",
    "const fixed = 'Use a value.';",
    'const shaped: string = `Use ${String(1)} value.`;',
    'function named(name: string): string { return `Name ${quoted(name)}.`; }',
    'const arrow = (name: string): string => `Arrow ${quoted(name)}.`;',
    'function untyped(name: string) { return `Untyped ${quoted(name)}.`; }',
    'const computed = fixed + fixed;',
    'const table = { a: 1 };',
    'function twice(name: string): string;',
    'function twice(name: number): string;',
    'function twice(name: unknown): string { return `Twice ${quoted(name)}.`; }',
    'type Hidden = string;',
    'export type { Hidden };',
    'export { arrow, computed, fixed, named, quoted, shaped, table, twice, untyped };',
  ].join('\n');
  expect(
    localizationSites({ 'inputs/messages.ts': module, 'localization/registry.ts': registry }),
  ).toEqual([
    { check: 'export-shape', file: 'inputs/messages.ts', text: 'computed' },
    { check: 'export-shape', file: 'inputs/messages.ts', text: 'quoted (not declared here)' },
    { check: 'export-shape', file: 'inputs/messages.ts', text: 'table' },
    { check: 'export-shape', file: 'inputs/messages.ts', text: 'twice (overloaded)' },
    { check: 'export-shape', file: 'inputs/messages.ts', text: 'untyped' },
  ]);
});

test('with a registry, a message module holds no exported class, enum, let, async function, export *, or default', () => {
  const module = [
    "export const fixed = 'Use a value.';",
    'export function named(name: string): string { return `Name ${name}.`; }',
    'export type Shape = string;',
    'export interface Member { readonly name: string }',
    'export class Helper {}',
    'export enum Mode { A }',
    "export let counter = 'Use a value.';",
    "export async function later(): Promise<string> { return 'Use a value.'; }",
    "export * from './other.js';",
    "export default 'Use a value.';",
  ].join('\n');
  expect(
    localizationSites({ 'inputs/messages.ts': module, 'localization/registry.ts': registry }),
  ).toEqual([
    { check: 'export-shape', file: 'inputs/messages.ts', text: 'Helper (class)' },
    { check: 'export-shape', file: 'inputs/messages.ts', text: 'Mode (enum)' },
    { check: 'export-shape', file: 'inputs/messages.ts', text: 'counter (let)' },
    { check: 'export-shape', file: 'inputs/messages.ts', text: 'later (async function)' },
    { check: 'export-shape', file: 'inputs/messages.ts', text: '* (export *)' },
    { check: 'export-shape', file: 'inputs/messages.ts', text: 'default (export default)' },
  ]);
});

test('an inline type specifier in an export list is a type, not a sentence', () => {
  const module = [
    "const fixed = 'Use a value.';",
    'interface Member { readonly name: string }',
    'export { fixed, type Member };',
  ].join('\n');
  expect(
    localizationSites({ 'inputs/messages.ts': module, 'localization/registry.ts': registry }),
  ).toEqual([]);
});

test('without a registry, a message module may export a helper, as a package that has not joined does', () => {
  const module = 'const table = { a: 1 };\nexport { table };';
  expect(
    voiceSites(new Map([['inputs/messages.ts', module]]), { banned: [] }).filter(
      (site) => site.check === 'export-shape',
    ),
  ).toEqual([]);
});

test('the registry names every message module under its concept module, and no other', () => {
  const sentence = "const fixed = 'Use a value.';\nexport { fixed };";
  expect(
    localizationSites({
      'failures/messages.ts': sentence,
      'inputs/messages.ts': sentence,
      'localization/registry.ts': [
        "import type * as inputs from '../inputs/messages.js';",
        'interface Modules {',
        "  readonly common: typeof import('../messages.js');",
        '  readonly input: typeof inputs;',
        "  readonly output: typeof import('../output/messages.js');",
        '}',
      ].join('\n'),
      'messages.ts': sentence,
    }),
  ).toEqual([
    {
      check: 'registry',
      file: 'localization/registry.ts',
      text: 'failures/messages.ts (not registered)',
    },
    {
      check: 'registry',
      file: 'localization/registry.ts',
      text: 'inputs/messages.ts (under input, not inputs)',
    },
    {
      check: 'registry',
      file: 'localization/registry.ts',
      text: 'output (names no message module)',
    },
  ]);
});
