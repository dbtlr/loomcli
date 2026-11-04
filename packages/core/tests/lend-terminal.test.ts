import { Application, Command, FatalError } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

const noop = () => {};

test('a lend holds frames, passes writes, and draws a fresh stack without erasing child output', async () => {
  const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
  const app = new Application('lend').action(async ({ out }) => {
    const region = out.region();
    await region.draw('before', { render: (text: string) => text });
    const start = mock.stderr.text;
    await expect(
      out.lendTerminal(async () => {
        expect(mock.stderr.text.slice(start.length)).toBe('\n');
        await region.draw('after', { render: (text: string) => text });
        await out.draw('child', { render: (text: string) => text });
        expect(mock.stderr.text.slice(start.length)).toBe('\nchild');
        return 42;
      }),
    ).resolves.toBe(42);
    expect(mock.stderr.text.slice(start.length)).toBe('\nchild\nafter');
    await region.end();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('failure closes regions immediately and waits for every lend before its report', async () => {
  const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
  let release = noop;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = noop;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let closed = noop;
  const closing = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const app = new Application('lend').action(async ({ out }) => {
    const region = out.region();
    region.signal.addEventListener('abort', () => {
      closed?.();
    });
    await region.draw('frame', { render: (text: string) => text });
    void out.lendTerminal(async () => {
      started?.();
      await waiting;
      await out.draw('last-child', { render: (text: string) => text });
    });
    await ready;
    throw new FatalError('failure-report');
  });
  const run = app.run({ process: mock });
  await closing;
  expect(mock.stderr.text).not.toContain('failure-report');
  release?.();
  await expect(run).resolves.toBe(1);
  expect(mock.stderr.text.indexOf('failure-report')).toBeGreaterThan(
    mock.stderr.text.indexOf('last-child'),
  );
});

test('suspend and resume during a lend write nothing', async () => {
  const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
  const app = new Application('lend').action(async ({ out }) => {
    const region = out.region();
    await region.draw('frame', { render: (text: string) => text });
    await out.lendTerminal(async () => {
      const before = mock.stderr.text;
      mock.signals.raise('SIGTSTP');
      await out.draw('', { render: (text: string) => text });
      expect(mock.stderr.text).toBe(before);
    });
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('a lend without a drawn frame writes nothing and propagates work rejection', async () => {
  const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
  const error = new Error('work');
  const app = new Application('lend').action(async ({ out }) => {
    await expect(
      out.lendTerminal(() => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(mock.stderr.text).toBe('');
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('a lend with no drawn region preserves the partial row for the next region', async () => {
  const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
  const app = new Application('lend').action(async ({ out }) => {
    await out.draw('partial', { render: (text: string) => text });
    await out.lendTerminal(() => 42);
    const region = out.region();
    await region.draw('frame', { render: (text: string) => text });
    expect(mock.stderr.text).toBe('partial\nframe');
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('nested lends add no rows and closed frames follow child output in close order', async () => {
  const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
  const app = new Application('lend').action(async ({ out }) => {
    const first = out.region();
    const second = out.region();
    const view = { render: (text: string) => text };
    await first.draw('one', view);
    await second.draw('two', view);
    const start = mock.stderr.text.length;
    await out.lendTerminal(async () => {
      await out.lendTerminal(async () => {
        await second.draw('two-final', view);
        await second.end();
        await first.draw('one-final', view);
        await first.end();
        await out.draw('child', view);
      });
      expect(mock.stderr.text.slice(start)).toBe('\nchild');
    });
    expect(mock.stderr.text.slice(start)).toBe('\nchild\ntwo-final\none-final\n');
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('a region first drawn during a lend that started with nothing drawn is held until it ends', async () => {
  const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
  const view = { render: (text: string) => text };
  const app = new Application('lend').action(async ({ out }) => {
    const region = out.region();
    await out.lendTerminal(async () => {
      await region.draw('LIVE', view);
      expect(mock.stderr.text).toBe('');
    });
    expect(mock.stderr.text).toBe('\nLIVE');
    await region.end();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('a region opened during a lend draws below the child output once the lend ends', async () => {
  const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
  const view = { render: (text: string) => text };
  const app = new Application('lend').action(async ({ out }) => {
    await out.lendTerminal(async () => {
      const region = out.region();
      await region.draw('LIVE', view);
      await out.draw('child-write', view);
      expect(mock.stderr.text).toBe('child-write');
    });
    expect(mock.stderr.text).toBe('child-write\nLIVE');
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('suspend and resume during a lend that started with nothing drawn write nothing', async () => {
  const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
  const view = { render: (text: string) => text };
  const app = new Application('lend').action(async ({ out }) => {
    const region = out.region();
    await out.lendTerminal(async () => {
      await region.draw('LIVE', view);
      mock.signals.raise('SIGTSTP');
      await out.draw('', view);
      expect(mock.stderr.text).toBe('');
    });
    expect(mock.stderr.text).toBe('\nLIVE');
    await region.end();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('a lend after a frame that ended its row writes no line break of its own', async () => {
  const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
  const view = { render: (text: string) => text };
  const app = new Application('lend').action(async ({ out }) => {
    const region = out.region();
    await region.draw('A\n', view);
    const start = mock.stderr.text.length;
    await out.lendTerminal(async () => {
      await out.draw('child', view);
    });
    expect(mock.stderr.text.slice(start)).toBe('child\nA\n');
    await region.end();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('a run that reports no failure writes its incomplete-result line once every lend has settled', async () => {
  const mock = mockProcess({ argv: ['count'], terminal: { columns: 80, rows: 24 } });
  const view = { render: (text: string) => text };
  const count = new Command('count')
    .rows<string>({ views: { list: { row: (row) => `${row}\n` } } })
    .action(async ({ cancel, out }) => {
      // The lend outlasts the action. It ends once the line has landed or the turns run out.
      // Only a run that writes the line during the lend lands it first.
      void out.lendTerminal(async () => {
        for (let turn = 0; turn < 100 && !mock.stderr.text.includes('incomplete'); turn += 1) {
          await new Promise((resolve) => {
            setImmediate(resolve);
          });
        }
        await out.draw('child\n', view);
      });
      async function* rows() {
        yield 'one';
        cancel();
      }
      await out.results(rows()).catch(() => undefined);
    });
  const app = new Application('lend').command(count);
  await expect(app.run({ process: mock })).resolves.toBe(130);
  const text = mock.stderr.text;
  expect(text).toContain('Output is incomplete');
  expect(text.indexOf('child')).toBeLessThan(text.indexOf('Output is incomplete'));
});
