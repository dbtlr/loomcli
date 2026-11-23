/*
 * Acceptance plan for localization (docs/core/localization.md and docs/plugins/localization.md).
 *
 * Through public APIs, a fixture Application, `mockProcess`, and the localization plugin:
 *
 * - The locale. `resolveLocale` reads LC_ALL, LC_MESSAGES, and LANG in that order, drops a codeset,
 *   maps a script modifier, reads C and POSIX as en, and reads en for no variable or a refused one.
 *   A run's host holds it, a supplied locale is normalized the same way, the empty string defers to
 *   the environment, a LANG an environment hook adds changes nothing, and an action's invoke keeps
 *   its run's locale.
 * - Rendering. With a `de` phrasebook, `LANG=de_DE.UTF-8` renders a core failure sentence and the
 *   incomplete-output line in the phrasebook's text with its values escaped as the entry escapes
 *   them; a sentence the phrasebook omits renders English; `LANG=fr` renders English; `de_AT`
 *   uses `de`; a nested issue renders in German inside an English frame.
 * - What stays English. The failure form, the failure's `message`, and its code are the same in
 *   every locale, while `invoke`'s `messages` reads German; a failure view's `context.message` is
 *   the localized sentence; a hint renders German for a person and English in the form.
 * - Faults. A phrasebook entry that throws while a failure renders takes the broken-view path: the
 *   English default text and exit 1. A language key that is not canonical is a declaration error.
 * - Logging. A `-v` line fills the localized template while an `onLog` hook reads the English one.
 * - Carriers. `phrasedIssue` keeps an issue's shape, `issuePhrase` follows the message,
 *   `failureLines` follows a failure's lines, and `replaceValue` swaps one value.
 */
import {
  Application,
  Command,
  DeclarationError,
  escapeControlCharacters,
  failureLines,
  InputError,
  issuePhrase,
  LoomError,
  override,
  phrasebook,
  phrasedIssue,
  phrases,
  plugin,
  provider,
  replaceValue,
  resolveLocale,
  UsageError,
} from '@loomcli/core';
import type { LogEvent, Phrase, Plugin, Provider, StandardSchemaV1 } from '@loomcli/core';
import { localization } from '@loomcli/plugins/localization';
import { mockProcess, viewContext } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** An application's own message module, registered so its sentences are phrases too. */
const notes = {
  checkLater: 'Check again later.',
  emptyTitle: 'The title is empty.',
  readTemplate: 'Read {file} in {ms} ms.',
  saved: (name: string): string => `Saved "${escapeControlCharacters(name)}".`,
  savedIn: (name: string, folder: string): string =>
    `Saved "${escapeControlCharacters(name)}" in ${folder}.`,
};

declare module '@loomcli/core' {
  interface MessagePackages {
    'localization-test': { readonly notes: typeof notes };
  }
}

const say = phrases('localization-test').module('notes', notes);

/** German quotation marks around an escaped value, as a German entry repeats one. */
const shown = (value: string) => `„${escapeControlCharacters(value)}“`;

const coreDe = phrasebook('@loomcli/core', {
  failures: {
    genericDefect: 'Etwas ist schiefgelaufen.',
    unknownOption: (spelling) => `Unbekannte Option ${shown(spelling)}.`,
    unknownOptionBeforeArguments: (spelling) =>
      `Unbekannte Option ${shown(spelling)}. Übergib sie nach "--" als Argument.`,
    workingDirectoryUnreadable: 'Das Arbeitsverzeichnis ist nicht lesbar.',
  },
  inputs: {
    requiredOption: (subject) => `Option ${shown(subject.spelling)} fehlt.`,
    silentRejection: 'Der Wert wurde abgelehnt.',
    unreadableFile: 'Keine lesbare Datei.',
  },
  invocation: { invalidTimeZone: 'Keine bekannte Zeitzone.' },
  output: {
    incompleteOutput: (_path, yielded, written) =>
      `Ausgabe unvollständig: ${String(yielded)} Zeilen, ${String(written)} geschrieben.`,
  },
  plugins: { closeFailed: 'Das Schließen eines Providers ist fehlgeschlagen.' },
});

const notesDe = phrasebook('localization-test', {
  notes: {
    checkLater: 'Später erneut prüfen.',
    emptyTitle: 'Der Titel ist leer.',
    readTemplate: '{file} in {ms} ms gelesen.',
    saved: (name) => `${shown(name)} gespeichert.`,
  },
});

/** A row source that fails after its first row. */
function* failing() {
  yield { name: 'one' };
  throw new InputError('The source failed.', []);
}

/** The localization plugin with the German phrasebooks. */
const german = () => localization({ locales: { de: [notesDe, coreDe] } });

/** Runs an application with the words and environment given, and returns what each stream holds. */
async function ran(
  app: { run: Application['run'] },
  argv: readonly string[],
  env: Record<string, string> = {},
) {
  const mock = mockProcess({ argv: [...argv], env });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

test.each([
  [{}, 'en'],
  [{ LANG: 'de_AT.UTF-8' }, 'de-AT'],
  [{ LANG: 'de_DE', LC_MESSAGES: 'fr_FR.UTF-8' }, 'fr-FR'],
  [{ LANG: 'de_DE', LC_ALL: 'pt_BR', LC_MESSAGES: 'fr_FR' }, 'pt-BR'],
  [{ LANG: 'de_DE', LC_ALL: '' }, 'de-DE'],
  [{ LANG: 'C' }, 'en'],
  [{ LANG: 'C.UTF-8' }, 'en'],
  [{ LANG: 'POSIX' }, 'en'],
  [{ LANG: 'sr_RS@latin' }, 'sr-Latn-RS'],
  [{ LANG: 'uz_UZ.UTF-8@cyrillic' }, 'uz-Cyrl-UZ'],
  [{ LANG: 'ca_ES@valencia' }, 'ca-ES-valencia'],
  [{ LANG: 'de_DE@euro' }, 'de-DE'],
  [{ LANG: 'de_DE@constructor' }, 'de-DE'],
  [{ LANG: 'iw_IL' }, 'he-IL'],
  [{ LANG: 'not a locale!' }, 'en'],
  [{ LANGUAGE: 'de' }, 'en'],
])('resolveLocale(%j) reads %s', (env, locale) => {
  expect(resolveLocale(env)).toBe(locale);
});

/** The locale an action reads from its host under one mock process. */
async function hostLocale(fields: Parameters<typeof mockProcess>[0]) {
  let read: string | undefined = undefined;
  const app = new Application('probe').action(({ host }) => {
    read = host.locale;
  });
  await app.run({ process: mockProcess(fields) });
  return read;
}

test('a run reads its locale from the handle or its environment, normalized once', async () => {
  await expect(hostLocale({})).resolves.toBe('en');
  await expect(hostLocale({ env: { LANG: 'de_DE.UTF-8' } })).resolves.toBe('de-DE');
  await expect(hostLocale({ locale: 'de_DE' })).resolves.toBe('de-DE');
  await expect(hostLocale({ locale: 'de-DE' })).resolves.toBe('de-DE');
  await expect(hostLocale({ env: { LANG: 'fr_FR' }, locale: '' })).resolves.toBe('fr-FR');
});

test('a LANG an environment hook adds never changes the locale, and an action invoke keeps it', async () => {
  const seen: (string | undefined)[] = [];
  const adds = plugin('lang-adder', { onEnvironment: () => ({ LANG: 'de_DE.UTF-8' }) });
  const app = new Application('probe', { plugins: [adds] })
    .command(
      new Command('inner').action(({ host }) => {
        seen.push(host.locale);
      }),
    )
    .action(async ({ host, invoke }) => {
      seen.push(host.locale, host.env.LANG);
      await invoke(['inner'], {});
    });
  await app.run({ process: mockProcess({ env: {} }) });
  expect(seen).toEqual(['en', 'de_DE.UTF-8', 'en']);
});

test('a core failure sentence renders in the phrasebook, its value escaped as the entry escapes it', async () => {
  const app = new Application('notes', { plugins: [german()] }).action(() => undefined);
  await expect(ran(app, ['--bo\u0007gus'], { LANG: 'de_DE.UTF-8' })).resolves.toEqual({
    code: 2,
    stderr: `notes: Unbekannte Option ${shown('--bo\u0007gus')}.\n`,
    stdout: '',
  });
  expect(shown('--bo\u0007gus')).not.toContain('\u0007');
});

test('a region-tagged locale uses its language, and a language with no list renders English', async () => {
  const app = new Application('notes', { plugins: [german()] }).action(() => undefined);
  const austrian = await ran(app, ['--bogus'], { LANG: 'de_AT.UTF-8' });
  expect(austrian.stderr).toBe('notes: Unbekannte Option „--bogus“.\n');
  const french = await ran(app, ['--bogus'], { LANG: 'fr_FR.UTF-8' });
  const english = await ran(
    new Application('notes').action(() => undefined),
    ['--bogus'],
  );
  expect(french).toEqual(english);
  expect(french.stderr).toBe(
    'notes: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n',
  );
});

test('a sentence the phrasebook omits renders its English export', async () => {
  const app = new Application('notes', { plugins: [german()] })
    .option('name', { type: 'string' })
    .action(() => undefined);
  const result = await ran(app, ['--name', 'a', '--name', 'b'], { LANG: 'de_DE.UTF-8' });
  expect(result.stderr).toBe(
    'notes: Option "--name" can be supplied only once. Remove the repeated option.\n',
  );
});

test("the incomplete-output line renders in the phrasebook's text", async () => {
  const list = { row: (row: { name: string }) => `${row.name}\n` };
  const app = new Application('notes', { plugins: [german()] })
    .rows<{ name: string }>({ views: { list } })
    .action(async ({ out }) => {
      await out.results(failing());
    });
  const result = await ran(app, [], { LANG: 'de_DE.UTF-8' });
  expect(result).toEqual({
    code: 2,
    stderr: 'Ausgabe unvollständig: 1 Zeilen, 1 geschrieben.\nnotes: The source failed.\n',
    stdout: 'one\n',
  });
});

test('a nested issue renders German inside the English frame no phrasebook holds', async () => {
  const silent: StandardSchemaV1 = {
    '~standard': { validate: () => ({ issues: [] }), vendor: 'test', version: 1 },
  };
  const app = new Application('notes', { plugins: [german()] })
    .option('size', { type: 'string', validate: silent })
    .action(() => undefined);
  const result = await ran(app, ['--size', 'x'], { LANG: 'de_DE.UTF-8' });
  expect(result.stderr).toBe('notes: Option "--size": Der Wert wurde abgelehnt.\n');
});

test('a sentence core restates after construction renders in the phrasebook', async () => {
  const app = new Application('notes', { plugins: [german()] })
    .argument('file', {})
    .action(() => undefined);
  const result = await ran(app, ['--bogus'], { LANG: 'de_DE.UTF-8' });
  expect(result.stderr).toBe(
    'notes: Unbekannte Option „--bogus“. Übergib sie nach "--" als Argument.\n',
  );
});

test('the failure form, message, and code stay English while messages reads German', async () => {
  const app = new Application('notes', { plugins: [german()] })
    .option('title', { required: true, type: 'string' })
    .action(() => undefined);
  const outcome = async (env: Record<string, string>) =>
    await app.invoke([], {}, { process: mockProcess({ env }) });
  const english = await outcome({});
  const localized = await outcome({ LANG: 'de_DE.UTF-8' });
  expect(english.status).toBe('failed');
  expect(localized.status).toBe('failed');
  if (english.status !== 'failed' || localized.status !== 'failed') {
    return;
  }
  expect(localized.form).toEqual(english.form);
  expect(localized.form.code).toBe('invalid-input');
  expect(localized.failure.message).toBe(english.failure.message);
  expect(localized.form.message).toMatch(/^Option "title" is required/u);
  expect(english.messages).toBe(`notes: ${english.form.message}\n`);
  expect(localized.messages).toBe('notes: Option „title“ fehlt.\n');
});

test('a failure view reads the localized sentence as context.message and English as failure.message', async () => {
  const app = new Application('notes', {
    plugins: [german()],
    views: [
      override(UsageError, {
        render: (failure, context) => `${context.message} | ${failure.message}\n`,
      }),
    ],
  }).action(() => undefined);
  const result = await ran(app, ['--bogus'], { LANG: 'de_DE.UTF-8' });
  expect(result.stderr).toBe(
    'Unbekannte Option „--bogus“. | Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n',
  );
});

test("a failure view's context.message for a defect is the generic message the default text renders", async () => {
  const secret = 'ECONNREFUSED db.internal:5432 with hunter2-SECRET';
  const app = new Application('notes', {
    plugins: [german()],
    views: [
      override(LoomError, {
        render: (_failure, context) => `${context.application}: ${context.message}\n`,
      }),
    ],
  }).action(() => {
    throw new Error(secret);
  });
  const reported = async (build: 'development' | 'distributed', env: Record<string, string>) => {
    const mock = mockProcess({ env, release: { build } });
    const code = await app.run({ process: mock });
    return { code, stderr: mock.stderr.text };
  };
  await expect(reported('distributed', {})).resolves.toEqual({
    code: 1,
    stderr: 'notes: Something went wrong.\n',
  });
  await expect(reported('distributed', { LANG: 'de_DE.UTF-8' })).resolves.toEqual({
    code: 1,
    stderr: 'notes: Etwas ist schiefgelaufen.\n',
  });
  const development = await reported('development', { LANG: 'de_DE.UTF-8' });
  expect(development.code).toBe(1);
  expect(development.stderr).toContain(secret);
  expect(development.stderr).not.toContain('notes: Etwas ist schiefgelaufen.');
  expect(development.stderr).not.toMatch(/^notes: ECONNREFUSED/mu);
});

test('a failure raised while the host is captured renders in the phrasebook', async () => {
  const app = new Application('notes', { plugins: [german()] }).action(() => undefined);
  const mock = mockProcess({ env: { LANG: 'de_DE.UTF-8' } });
  const unreadable = {
    ...mock,
    cwd: () => {
      throw new Error('private reason');
    },
  };
  await expect(app.run({ process: unreadable })).resolves.toBe(1);
  expect(mock.stderr.text).toBe('notes: Das Arbeitsverzeichnis ist nicht lesbar.\n');
});

test("an invocation's time zone no runtime knows renders in the phrasebook, nested in an action too", async () => {
  const process = mockProcess({ env: { LANG: 'de_DE.UTF-8' } });
  const leaf = new Application('notes', { plugins: [german()] });
  const outer = await leaf.invoke([], {}, { process, timeZone: 'Nope/Zone' });
  expect(outer.status === 'failed' && outer.messages).toBe('notes: Keine bekannte Zeitzone.\n');
  const nested: string[] = [];
  const app = new Application('notes', { plugins: [german()] }).action(async ({ invoke }) => {
    const inner = await invoke([], {}, { timeZone: 'Nope/Zone' });
    nested.push(inner.status === 'failed' ? inner.messages : inner.status);
  });
  await expect(app.run({ process: mockProcess({ env: { LANG: 'de_DE.UTF-8' } }) })).resolves.toBe(
    0,
  );
  expect(nested).toEqual(['notes: Keine bekannte Zeitzone.\n']);
});

test('hints under a Developer Diagnostic stay English while the run reads German', async () => {
  const hinting = plugin('hinting', { onFailure: () => say('checkLater') });
  const app = new Application('notes', { plugins: [german(), hinting] }).action(() => {
    throw new Error('The action broke.');
  });
  const mock = mockProcess({ env: { LANG: 'de_DE.UTF-8' }, release: { build: 'development' } });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(mock.stderr.text).toContain('\nCheck again later.\n');
  expect(mock.stderr.text).not.toContain('Später erneut prüfen.');
});

/** A Standard Schema validator that rejects every value with the issues `issues` makes. */
function rejecting(issues: () => StandardSchemaV1.Issue[]): StandardSchemaV1 {
  return { '~standard': { validate: () => ({ issues: issues() }), vendor: 'test', version: 1 } };
}

test.each([
  ['an issue with no path', () => phrasedIssue(say('emptyTitle')), []],
  ['an issue with a path', () => phrasedIssue(say('emptyTitle'), { path: ['x'] }), []],
  ['an issue of a list input', () => phrasedIssue(say('emptyTitle')), ['--title', 'b']],
] as const)(
  "%s a validator returns renders in the phrasebook through core's copy",
  async (_case, issue, more) => {
    const validate = rejecting(() => [issue()]);
    const base = new Application('notes', { plugins: [german()] });
    const app =
      more.length > 0
        ? base.option('title', { multiple: true, type: 'string', validate }).action(() => undefined)
        : base.option('title', { type: 'string', validate }).action(() => undefined);
    const result = await ran(app, ['--title', 'a', ...more], { LANG: 'de_DE.UTF-8' });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Der Titel ist leer.');
    expect(result.stderr).not.toContain('The title is empty.');
  },
);

test('an issue of a collected content input renders in the phrasebook', async () => {
  const app = new Application('notes', { plugins: [german()] })
    .option('file', { multiple: true, type: 'content' })
    .action(() => undefined);
  const result = await ran(app, ['--file', 'a\0b'], { LANG: 'de_DE.UTF-8' });
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('Keine lesbare Datei.');
  expect(result.stderr).not.toContain('Expected a readable file');
});

test('an issue reworded in place repeats its reword, not its phrase', async () => {
  const issue = phrasedIssue(say('emptyTitle'));
  Object.assign(issue, { message: 'Reworded.' });
  const app = new Application('notes', { plugins: [german()] }).action(async ({ out }) => {
    await out.print(issuePhrase(issue) ?? issue.message);
  });
  const result = await ran(app, [], { LANG: 'de_DE.UTF-8' });
  expect(result.stdout).toBe('Reworded.\n');
});

test('a hint phrase renders German under the failure and English in the form', async () => {
  const hinting = plugin('hinting', { onFailure: () => say('checkLater') });
  const app = new Application('notes', { plugins: [german(), hinting] })
    .option('title', { required: true, type: 'string' })
    .action(() => undefined);
  const result = await ran(app, ['--bogus'], { LANG: 'de_DE.UTF-8' });
  expect(result.stderr).toBe('notes: Unbekannte Option „--bogus“.\nSpäter erneut prüfen.\n');
  const process = mockProcess({ env: { LANG: 'de_DE.UTF-8' } });
  const outcome = await app.invoke([], {}, { process });
  expect(outcome.status === 'failed' && outcome.form.hints).toEqual(['Check again later.']);
});

test('an out call renders its phrase where the line is written, and an author failure of phrases', async () => {
  const app = new Application('notes', { plugins: [german()] }).action(async ({ out }) => {
    await out.warn(say('saved', 'list'));
    await out.print(say('savedIn', 'list', 'home'));
    throw new InputError([say('emptyTitle'), 'as written'], []);
  });
  const result = await ran(app, [], { LANG: 'de_DE.UTF-8' });
  expect(result.stdout).toBe('Saved "list" in home.\n');
  expect(result.stderr).toContain('„list“ gespeichert.\n');
  expect(result.stderr).toContain('notes: Der Titel ist leer.\nnotes: as written\n');
});

test('a phrasebook entry that throws takes the broken-view path with the English text', async () => {
  const broken = phrasebook('@loomcli/core', {
    failures: {
      unknownOption: () => {
        throw new Error('The entry broke.');
      },
    },
  });
  const app = new Application('notes', {
    plugins: [localization({ locales: { de: [broken] } })],
  }).action(() => undefined);
  const result = await ran(app, ['--bogus'], { LANG: 'de_DE.UTF-8' });
  expect(result.code).toBe(1);
  expect(result.stderr.startsWith('notes: Unknown option "--bogus".')).toBe(true);
  expect(result.stdout).toBe('');
});

test('a -v line fills the localized template while an onLog hook reads the English one', async () => {
  const heard: LogEvent[] = [];
  const listening = plugin('listening', {
    onLog: (event) => {
      heard.push(event);
      return undefined;
    },
  });
  const app = new Application('notes', { plugins: [german(), listening] })
    .globalOption('verbose', { short: 'v', type: 'count', verbose: true })
    .action(({ log }) => {
      log.debug(say('readTemplate'), { file: 'a.json', ms: 12, note: say('checkLater') });
    });
  const result = await ran(app, ['-v'], { LANG: 'de_DE.UTF-8' });
  expect(result.stderr).toBe('› a.json in 12 ms gelesen. note="Später erneut prüfen."\n');
  const [event] = heard;
  expect(event?.message).toBe('Read {file} in {ms} ms.');
  expect(event?.fields).toEqual({ file: 'a.json', ms: 12, note: 'Check again later.' });
});

/** A provider whose close throws. */
const closing = (name: string): Provider<string, string> =>
  provider<Provider<string, string>>(name, {
    close: () => {
      throw new Error(`${name} gone`);
    },
    load: async () => ({ default: () => name }),
  });

test('a provider close that throws logs its template in the phrasebook and keeps the English record', async () => {
  const heard: LogEvent[] = [];
  const listening = plugin('listening', {
    onLog: (event) => {
      heard.push(event);
      return undefined;
    },
  });
  const app = new Application('notes', { plugins: [german(), listening] })
    .globalOption('verbose', { short: 'v', type: 'count', verbose: true })
    .command(
      new Command('get', { uses: [closing('first'), closing('second')] }).action(() => undefined),
    );
  const result = await ran(app, ['get', '-v'], { LANG: 'de_DE.UTF-8' });
  expect(result.stderr).toContain('Das Schließen eines Providers ist fehlgeschlagen.');
  expect(result.stderr).not.toContain("A provider's close failed.");
  const closes = heard.filter(({ level }) => level === 'error');
  expect(closes.map(({ message }) => message)).toEqual(["A provider's close failed."]);
});

test('a redacted phrase field reads [Redacted] on the -v line and in the record', async () => {
  const heard: LogEvent[] = [];
  const listening = plugin('listening', {
    onLog: (event) => {
      heard.push(event);
      return undefined;
    },
  });
  const app = new Application('notes', {
    log: { redact: ['note'] },
    plugins: [german(), listening],
  })
    .globalOption('verbose', { short: 'v', type: 'count', verbose: true })
    .action(({ log }) => {
      log.debug(say('readTemplate'), { file: 'a.json', ms: 12, note: say('checkLater') });
    });
  const result = await ran(app, ['-v'], { LANG: 'de_DE.UTF-8' });
  expect(result.stderr).toBe('› a.json in 12 ms gelesen. note=[Redacted]\n');
  expect(heard[0]?.fields).toEqual({ file: 'a.json', ms: 12, note: '[Redacted]' });
});

test('a log call no hook hears and no verbosity shows runs no message export', async () => {
  let calls = 0;
  const counted = {
    ...notes,
    saved: (name: string): string => {
      calls += 1;
      return `Saved "${name}" as {file}.`;
    },
  };
  const counting = phrases('localization-test').module('notes', counted);
  const app = new Application('notes', { plugins: [german()] })
    .globalOption('verbose', { short: 'v', type: 'count', verbose: true })
    .action(({ log }) => {
      log.debug(counting('saved', 'x'), { file: 'a.json' });
    });
  const result = await ran(app, [], { LANG: 'de_DE.UTF-8' });
  expect(result).toEqual({ code: 0, stderr: '', stdout: '' });
  expect(calls).toBe(0);
});

/*
 * Runtimes map a few deprecated codes differently: Node writes tl as fil, and Bun keeps tl. The
 * cases hold only iw, which both write as he.
 */
test.each([['de-AT'], ['DE'], ['german'], ['iw']])(
  'a phrasebook language key %s is a declaration error',
  (key) => {
    let thrown: unknown = undefined;
    try {
      plugin('keys', { phrasebooks: { [key]: [coreDe] } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DeclarationError);
    expect(thrown).toMatchObject({ rule: { identity: '@loomcli/core/phrasebook-language' } });
  },
);

test('a canonical language key is accepted, and a deprecated one names its canonical form', () => {
  expect(() => plugin('keys', { phrasebooks: { de: [coreDe], fil: [] } })).not.toThrow();
  expect(() => plugin('keys', { phrasebooks: { iw: [] } })).toThrow(/Write "he"\./u);
});

test('phrasedIssue keeps the issue shape, and issuePhrase follows its message', () => {
  const phrase = say('emptyTitle');
  const issue = phrasedIssue(phrase, { path: ['title'] });
  expect(issue).toStrictEqual({ message: 'The title is empty.', path: ['title'] });
  expect(JSON.stringify(issue)).toBe('{"path":["title"],"message":"The title is empty."}');
  expect(issuePhrase(issue)).toBe(phrase);
  expect(issuePhrase({ ...issue })).toBeUndefined();
  expect(issuePhrase({ message: 'The title is empty.' })).toBeUndefined();
  const bare = phrasedIssue(phrase);
  expect(bare).toStrictEqual({ message: 'The title is empty.' });
});

test('failureLines follows the lines while the message reads them, and replaceValue swaps one value', () => {
  const failure = new InputError([say('saved', 'list'), 'as written'], []);
  expect(failure.message).toBe('Saved "list".\nas written');
  const lines = failureLines(failure);
  expect(lines?.length).toBe(2);
  const [first] = lines ?? [];
  const swapped = typeof first === 'object' ? replaceValue(first, 'list', 'todo') : undefined;
  expect(swapped?.text).toBe('Saved "todo".');
  expect(typeof first === 'object' && replaceValue(first, 'absent', 'x')).toBeUndefined();
  failure.message = 'Reworded.';
  expect(failureLines(failure)).toBeUndefined();
});

test('a phrase computes its English text on first read and writes it as JSON', () => {
  let calls = 0;
  const counted = {
    ...notes,
    saved: (name: string): string => {
      calls += 1;
      return `Saved "${name}".`;
    },
  };
  const counting = phrases('localization-test').module('notes', counted);
  const phrase: Phrase = counting('saved', 'x');
  expect(calls).toBe(0);
  expect(JSON.stringify({ phrase })).toBe(String.raw`{"phrase":"Saved \"x\"."}`);
  expect(phrase.text).toBe('Saved "x".');
  expect(calls).toBe(1);
});

test("viewContext answers an unstated localize with the phrase's English text", () => {
  const label = { render: () => '' };
  expect(viewContext(label, {}).localize(say('checkLater'))).toBe('Check again later.');
});

test('a plugin that installs a list of phrasebooks keeps the first that holds a sentence', async () => {
  const correction = phrasebook('localization-test', {
    notes: { checkLater: 'Bitte später prüfen.' },
  });
  const app = new Application('notes', {
    plugins: [localization({ locales: { de: [correction, notesDe] } })],
  }).action(async ({ out }) => {
    await out.print(say('checkLater'));
    await out.print(say('emptyTitle'));
  });
  const result = await ran(app, [], { LANG: 'de_DE.UTF-8' });
  expect(result.stdout).toBe('Bitte später prüfen.\nDer Titel ist leer.\n');
});

/** Keeps the `Plugin` type in use where the localization plugin is installed. */
const installed: Plugin = german();
void installed;
