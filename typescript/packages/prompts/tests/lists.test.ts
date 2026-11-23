/*
 * Select and multiselect behavior through the public surface (docs/libs/prompts.md#choices,
 * #moving-through-choices, #searching, #resolving-a-question): each case runs an Application on a
 * mock terminal and reads the answer, the exit code, and the frames the question drew.
 */
import { stripVTControlCharacters } from 'node:util';

import { Application, override } from '@loomcli/core';
import { key, mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import type { ChoiceEntry } from '../src/index.js';
import { multiselect, select, text } from '../src/index.js';
import { questionFrame } from '../src/views.js';
import type { ChoiceRow, QuestionFrame, SeparatorRow } from '../src/views.js';

/**
 * The frames a question draws, recorded through an override that draws each as the default, with
 * `drawn` called after each frame is recorded.
 */
function recorder(drawn: (frames: readonly QuestionFrame[]) => void = () => {}) {
  const frames: QuestionFrame[] = [];
  const views = [
    override(questionFrame, {
      render: (data, context) => {
        frames.push(data);
        drawn(frames);
        return questionFrame.render(data, context);
      },
    }),
  ];
  return { frames, views };
}

/** The list frames among `frames`, which every list question draws. */
function lists(frames: readonly QuestionFrame[]) {
  return frames.flatMap((frame) =>
    frame.kind === 'select' || frame.kind === 'multiselect' ? [frame] : [],
  );
}

/** The label of each visible row of a list frame. */
function labels(choices: readonly (ChoiceRow | SeparatorRow)[]): string[] {
  return choices.map((row) => row.label);
}

/** A promise with its resolver, for a source call a test settles at a point it chooses. */
function deferred<Value>() {
  return Promise.withResolvers<Value>();
}

const regions = (term: string): readonly ChoiceEntry<string>[] =>
  term === '' ? ['us-east', 'eu-west'] : [];

test.each([
  ['the disabled match first', [{ disabled: 'needs an account', value: 'ap-south' }, 'ap-north']],
  [
    'a separator, then the disabled match',
    [{ separator: 'Asia' }, { disabled: true, value: 'ap-south' }],
  ],
])(
  'a supplied value whose lookup finds it disabled keeps the first list, with %s',
  async (_case, lookup: readonly ChoiceEntry<string>[]) => {
    const mock = mockProcess({
      argv: ['--pick', 'ap-south'],
      terminal: { columns: 80, keys: [key.enter], rows: 24, streams: ['stderr'] },
    });
    let answer: unknown = undefined;
    const app = new Application('regions')
      .option('pick', { type: 'string' })
      .action(async (context) => {
        answer = await select(context, {
          message: 'Region',
          option: 'pick',
          source: (term) => (term === 'ap-south' ? lookup : regions(term)),
        });
      });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(answer).toBe('us-east');
    expect(stripVTControlCharacters(mock.stderr.text)).toContain(
      'Cannot select "ap-south". Choose from the list.',
    );
  },
);

test('a supplied value draws the loading frame before its slow first call and lookup settle', async () => {
  const { frames, views } = recorder();
  const mock = mockProcess({
    argv: ['--pick', 'ap-south'],
    terminal: { columns: 80, keys: [key.enter], rows: 24, streams: ['stderr'] },
  });
  let answer: unknown = undefined;
  const app = new Application('regions', { views })
    .option('pick', { type: 'string' })
    .action(async (context) => {
      answer = await select(context, {
        message: 'Region',
        option: 'pick',
        source: (term) =>
          Promise.resolve(term === 'ap-south' ? ['ap-south', 'ap-north'] : regions(term)),
      });
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toBe('ap-south');
  const drawn = lists(frames);
  expect(drawn[0]).toMatchObject({ choices: [], highlighted: undefined, loading: true });
  expect(drawn.at(-1)).toMatchObject({ highlighted: 0, loading: false, term: 'ap-south' });
  expect(labels(drawn.at(-1)?.choices ?? [])).toEqual(['ap-south', 'ap-north']);
  const output = stripVTControlCharacters(mock.stderr.text);
  expect(output.indexOf('Searching…')).toBeGreaterThan(-1);
  expect(output.indexOf('Searching…')).toBeLessThan(output.indexOf('❯ ap-south'));
});

test('a lookup a first call settled at once draws a loading frame over the first list', async () => {
  const { frames, views } = recorder();
  const mock = mockProcess({
    argv: ['--pick', 'ap-south'],
    terminal: { columns: 80, keys: [key.enter], rows: 24, streams: ['stderr'] },
  });
  const app = new Application('regions', { views })
    .option('pick', { type: 'string' })
    .action(async (context) => {
      await expect(
        select(context, {
          message: 'Region',
          option: 'pick',
          source: (term) => (term === '' ? regions(term) : Promise.resolve(['ap-south'])),
        }),
      ).resolves.toBe('ap-south');
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  const drawn = lists(frames);
  expect(drawn[0]).toMatchObject({ loading: true });
  expect(labels(drawn[0]?.choices ?? [])).toEqual(['us-east', 'eu-west']);
  expect(drawn.at(-1)).toMatchObject({ loading: false, term: 'ap-south' });
});

test('a hanging lookup still draws the loading frame, and Ctrl-C cancels it', async () => {
  const signals: AbortSignal[] = [];
  const mock = mockProcess({
    argv: ['--pick', 'ap-south'],
    terminal: { columns: 80, keys: [[]], rows: 24, streams: ['stderr'] },
  });
  const { frames, views } = recorder((drawn) => {
    if (drawn.length === 1) {
      // The interrupt arrives once the loading frame is drawn, as an operator's would.
      setImmediate(() => mock.stdin.push(key.ctrl('c')));
    }
  });
  const app = new Application('regions', { views })
    .option('pick', { type: 'string' })
    .action(async (context) => {
      await select(context, {
        message: 'Region',
        option: 'pick',
        source: (term, { signal }) => {
          signals.push(signal);
          return term === '' ? regions(term) : new Promise<readonly string[]>(() => {});
        },
      });
    });
  await expect(app.run({ process: mock })).resolves.toBe(130);
  expect(lists(frames)[0]).toMatchObject({ loading: true });
  expect(stripVTControlCharacters(mock.stderr.text)).toContain('Searching…');
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

test('a null default opens on the choice whose value is null', async () => {
  const mock = mockProcess({
    terminal: { columns: 80, keys: [key.enter], rows: 24, streams: ['stderr'] },
  });
  let answer: unknown = 'unanswered';
  const app = new Application('nullable').action(async (context) => {
    answer = await select(context, {
      choices: [
        { label: 'One', value: 1 },
        { label: 'None', value: null },
      ],
      default: null,
      message: 'Count',
    });
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toBeNull();
});

test('without a default, a choice whose value is undefined is not the prefill', async () => {
  const mock = mockProcess({
    terminal: { columns: 80, keys: [key.enter], rows: 24, streams: ['stderr'] },
  });
  let answer: unknown = 'unanswered';
  const app = new Application('optional').action(async (context) => {
    answer = await select(context, {
      choices: [
        { label: 'First', value: 1 },
        { label: 'Skip', value: undefined },
      ],
      message: 'Pick',
    });
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toBe(1);
});

test('an empty answer draws as main did for a text question and as a dim none for a multiselect', async () => {
  const mock = mockProcess({
    terminal: { columns: 80, keys: [key.enter, key.enter], rows: 24, streams: ['stderr'] },
  });
  const app = new Application('empty').action(async (context) => {
    await text(context, { message: 'Name' });
    await multiselect(context, { choices: ['a'], message: 'Tags' });
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  const output = stripVTControlCharacters(mock.stderr.text);
  expect(output).toContain('? Name · \n');
  expect(output).toContain('? Tags · none\n');
});

test('a stale first call that settles after a later call never replaces its list', async () => {
  const first = deferred<readonly string[]>();
  const mock = mockProcess({
    terminal: { columns: 80, keys: [`u${key.enter}`], rows: 24, streams: ['stderr'] },
  });
  let answer: unknown = undefined;
  const app = new Application('stale').action(async (context) => {
    answer = await select(context, {
      message: 'Country',
      source: (term) => {
        if (term === '') {
          return first.promise;
        }
        // The first call settles while the later call's own settle is under way.
        queueMicrotask(() => first.resolve(['stale']));
        return ['fresh'];
      },
    });
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toBe('fresh');
});

test('a first call aborted while its prefill resolves draws no settled frame', async () => {
  const first = deferred<readonly string[]>();
  const later = deferred<readonly string[]>();
  const mock = mockProcess({
    terminal: { columns: 80, keys: [[]], rows: 24, streams: ['stderr'] },
  });
  const { frames, views } = recorder((drawn) => {
    if (drawn.length === 1) {
      setImmediate(() => {
        /*
         * The first call settles in the same read that delivers the key that changes the term, after
         * the reader has taken the key, so the key's new call aborts the first call while the first
         * call's settle awaits its prefill.
         */
        mock.stdin.once('data', () => first.resolve(['stale']));
        mock.stdin.push('u');
      });
    }
  });
  const app = new Application('aborted', { views }).action(async (context) => {
    const answering = select(context, {
      message: 'Country',
      source: (term) => (term === '' ? first.promise : later.promise),
    });
    await first.promise;
    await new Promise((resolve) => setImmediate(resolve));
    later.resolve(['fresh']);
    await new Promise((resolve) => setImmediate(resolve));
    mock.stdin.push(key.enter);
    await expect(answering).resolves.toBe('fresh');
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  const settledStale = lists(frames).filter(
    (frame) =>
      frame.term === 'u' && frame.loading !== true && labels(frame.choices).includes('stale'),
  );
  expect(settledStale).toEqual([]);
});

/** A multiselect over `choices` whose recorded frames a test reads after `keys`. */
async function selecting(
  keys: string,
  settings: { min?: number; max?: number; search?: boolean } = {},
  choices: readonly ChoiceEntry<string>[] = ['alpha', 'beta', 'gamma'],
) {
  const { frames, views } = recorder();
  const mock = mockProcess({
    terminal: { columns: 80, keys: [keys], rows: 24, streams: ['stderr'] },
  });
  let answer: unknown = undefined;
  const app = new Application('toggles', { views }).action(async (context) => {
    answer = await multiselect(context, { choices, message: 'Pick', ...settings });
  });
  const code = await app.run({ process: mock });
  return { answer, code, frames: lists(frames), output: mock.stderr.text };
}

test('a toggle in clears the issue that min drew', async () => {
  const { answer, frames } = await selecting(key.enter + key.space + key.enter, { min: 1 });
  expect(answer).toEqual(['alpha']);
  expect(frames.map((frame) => frame.issue)).toEqual([undefined, 'Choose at least 1.', undefined]);
});

test('a toggle out clears the issue that a rejected choice drew', async () => {
  const { frames, views } = recorder();
  const mock = mockProcess({
    terminal: {
      columns: 80,
      keys: [key.tab + key.enter + key.tab + key.down + key.tab + key.enter],
      rows: 24,
      streams: ['stderr'],
    },
  });
  let answer: unknown = undefined;
  const app = new Application('linked', { views })
    .option('port', {
      multiple: true,
      type: 'string',
      validate: {
        '~standard': {
          validate: (value) =>
            value === 'bad' ? { issues: [{ message: 'Use a port.' }] } : { value: Number(value) },
          vendor: 'test',
          version: 1,
        },
      },
    })
    .action(async (context) => {
      answer = await multiselect(context, {
        choices: [{ label: 'Invalid', value: 'bad' }, '80'],
        message: 'Ports',
        option: 'port',
      });
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toEqual([80]);
  expect(lists(frames).map((frame) => frame.issue)).toEqual([
    undefined,
    undefined,
    'Invalid: Use a port.',
    undefined,
    undefined,
    undefined,
  ]);
});

test('a linked select draws its validator issue without a label', async () => {
  const { frames, views } = recorder();
  const mock = mockProcess({
    terminal: {
      columns: 80,
      keys: [key.enter + key.down + key.enter],
      rows: 24,
      streams: ['stderr'],
    },
  });
  const app = new Application('linked', { views })
    .option('port', {
      type: 'string',
      validate: {
        '~standard': {
          validate: (value) =>
            value === 'bad' ? { issues: [{ message: 'Use a port.' }] } : { value: Number(value) },
          vendor: 'test',
          version: 1,
        },
      },
    })
    .action(async (context) => {
      await expect(
        select(context, {
          choices: [{ label: 'Invalid', value: 'bad' }, '80'],
          message: 'Port',
          option: 'port',
        }),
      ).resolves.toBe(80);
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(lists(frames)[1]?.issue).toBe('Use a port.');
});

test('a search with no choice to highlight draws No matches, and Enter draws an issue the next term change clears', async () => {
  const mock = mockProcess({
    terminal: {
      columns: 80,
      keys: [`zz${key.enter}${key.ctrl('u')}${key.enter}`],
      rows: 24,
      streams: ['stderr'],
    },
  });
  const { frames, views } = recorder();
  let answer: unknown = undefined;
  const app = new Application('search', { views }).action(async (context) => {
    answer = await select(context, { choices: ['alpha', 'beta'], message: 'Pick', search: true });
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toBe('alpha');
  const drawn = lists(frames);
  expect(drawn.map((frame) => [frame.term, frame.issue])).toEqual([
    ['', undefined],
    ['z', undefined],
    ['zz', undefined],
    ['zz', 'No choice can be selected. Change the search.'],
    ['', undefined],
  ]);
  expect(stripVTControlCharacters(mock.stderr.text)).toContain(
    '? Pick › zz \n  No matches\n↑↓ move · type to search · Enter select\n  ✘ No choice can be selected. Change the search.',
  );
});

test('a static search highlights its first match again when the term changes', async () => {
  const { answer } = await selecting(`${key.down}${key.down}a${key.tab}${key.enter}`, {
    search: true,
  });
  expect(answer).toEqual(['alpha']);
});

test('the window ends at the list’s last row when the highlight reaches the last choice', async () => {
  const { frames } = await selecting(`${key.end}${key.enter}`, {}, [
    'c1',
    'c2',
    'c3',
    'c4',
    'c5',
    'c6',
    'c7',
    'c8',
    { disabled: true, value: 'c9' },
  ]);
  expect(frames[1]).toMatchObject({ above: 2, below: 0 });
  expect(labels(frames[1]?.choices ?? []).at(-1)).toBe('c9');
});

test('the window starts at the list’s first row when the highlight returns to the first choice', async () => {
  const { frames } = await selecting(`${key.end}${key.home}${key.enter}`, {}, [
    { separator: 'Top' },
    'c1',
    'c2',
    'c3',
    'c4',
    'c5',
    'c6',
    'c7',
    'c8',
  ]);
  expect(frames[2]).toMatchObject({ above: 0, below: 2 });
  expect(labels(frames[2]?.choices ?? [])[0]).toBe('Top');
});

test('a disabled choice with an empty reason draws (disabled)', async () => {
  const { output } = await selecting(key.enter, {}, ['alpha', { disabled: '', value: 'blocked' }]);
  expect(stripVTControlCharacters(output)).toContain('  ◯ blocked (disabled)\n');
});

test.each([
  ['an empty term', true, key.ctrl('d')],
  ['a list that does not search', false, key.ctrl('d')],
])('Ctrl-D cancels at %s', async (_case, search, keys) => {
  const { code, output } = await selecting(keys, { search });
  expect(code).toBe(130);
  expect(stripVTControlCharacters(output)).toContain('? Pick · cancelled');
});

test('Ctrl-D at the end of a term that is not empty deletes nothing and does not cancel', async () => {
  const { answer, code } = await selecting(`ga${key.ctrl('d')}${key.tab}${key.enter}`, {
    search: true,
  });
  expect(code).toBe(0);
  expect(answer).toEqual(['gamma']);
});

test('the end of the question aborts each lookup', async () => {
  const signals: AbortSignal[] = [];
  const mock = mockProcess({
    argv: ['--tag', 'b'],
    terminal: { columns: 80, keys: [key.enter], rows: 24, streams: ['stderr'] },
  });
  const app = new Application('linked')
    .option('tag', { multiple: true, type: 'string' })
    .action(async (context) => {
      await expect(
        multiselect(context, {
          message: 'Tags',
          option: 'tag',
          source: (term, { signal }) => {
            signals.push(signal);
            return term === '' ? ['a'] : [term];
          },
        }),
      ).resolves.toEqual(['b']);
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(signals).toHaveLength(2);
  expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
});

test.each([
  [['zzz'], 'choices'],
  [['zzz'], 'source'],
])('a default %j that selects nothing under %s draws no issue', async (defaults, kind) => {
  const { frames, views } = recorder();
  const mock = mockProcess({
    terminal: { columns: 80, keys: [key.enter], rows: 24, streams: ['stderr'] },
  });
  const choices: readonly ChoiceEntry[] = ['a', 'b'];
  const app = new Application('defaults', { views }).action(async (context) => {
    await expect(
      kind === 'choices'
        ? multiselect(context, { choices, default: defaults, message: 'Tags' })
        : multiselect(context, { default: defaults, message: 'Tags', source: () => choices }),
    ).resolves.toEqual([]);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(lists(frames).length).toBeGreaterThan(0);
  expect(lists(frames).every((frame) => frame.issue === undefined)).toBe(true);
});

test('a multiselect that links an option that takes one value reports its link kind', async () => {
  const app = new Application('link')
    .option('feature', { type: 'string' })
    .action(async (context) => {
      await multiselect(context, { choices: ['a'], message: 'Features', option: 'feature' });
    });
  const mock = mockProcess({ terminal: { columns: 80, keys: [], rows: 24 } });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(mock.stderr.text).toContain(
    'The question "Features" links option "feature", which is not a multiple string option.',
  );
  expect(mock.stderr.text).toContain(
    'Link a multiple string option or a variadic string argument.',
  );
});

test('a multiselect that links an argument that takes one value reports its link kind', async () => {
  const app = new Application('link').argument('file', {}).action(async (context) => {
    await multiselect(context, { argument: 'file', choices: ['a'], message: 'Features' });
  });
  const mock = mockProcess({ terminal: { columns: 80, keys: [], rows: 24 } });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(mock.stderr.text).toContain(
    'The question "Features" links argument "file", which is not a variadic string argument.',
  );
  expect(mock.stderr.text).toContain(
    'Link a multiple string option or a variadic string argument.',
  );
});

test.each([
  [
    'multiple option',
    'Option "--feature" is required when input is not interactive. Supply at least one value.',
  ],
  [
    'variadic argument',
    'Argument "files" requires at least one value when input is not interactive.',
  ],
])(
  'a non-interactive multiselect over an omitted %s reports the missing input',
  async (kind, sentence) => {
    const app = new Application('missing')
      .option('feature', { multiple: true, type: 'string' })
      .argument('files', { variadic: true })
      .action(async (context) => {
        await (kind === 'multiple option'
          ? multiselect(context, { choices: ['a'], message: 'Features', option: 'feature' })
          : multiselect(context, { argument: 'files', choices: ['a'], message: 'Files' }));
      });
    const mock = mockProcess();
    await expect(app.run({ process: mock })).resolves.toBe(2);
    expect(mock.stderr.text).toContain(sentence);
  },
);
