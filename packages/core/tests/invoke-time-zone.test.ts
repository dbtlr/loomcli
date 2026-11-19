import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { Application, Command, InputError, resolveTimeZone } from '../src/index.js';

const invalidSentence =
  'invoke() timeZone is not an IANA time zone name this runtime knows. Use a name such as "Asia/Tokyo".';

test.each(['Mars/Olympus', '', '+09:00', `${String.fromCodePoint(8722)}09:00`])(
  'an invalid per-call zone %j is an InputError without a received value',
  async (timeZone) => {
    let ran = false;
    const app = new Application('clock').action(() => {
      ran = true;
    });
    const outcome = await app.invoke([], {}, { process: mockProcess(), timeZone });
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      return;
    }
    expect(outcome.failure).toBeInstanceOf(InputError);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.form).toEqual({
      code: 'invalid-input',
      exitCode: 2,
      hints: [],
      message: invalidSentence,
    });
    expect(outcome.messages).toBe(`clock: ${invalidSentence}\n`);
    if (!(outcome.failure instanceof InputError)) {
      throw new Error('Expected an InputError.');
    }
    expect(outcome.failure.problems).toEqual([]);
    expect(ran).toBe(false);
  },
);

// Node spells US/Eastern as America/New_York and Bun keeps it, so the test reads the runtime's spelling.
test("a runtime-known alias gives the host the runtime's spelling of its zone", async () => {
  const spelled = resolveTimeZone('US/Eastern');
  expect(spelled).toBeDefined();
  const app = new Application('clock').action(async ({ host, out }) => {
    await out.print(host.timeZone);
  });
  await expect(
    app.invoke([], {}, { process: mockProcess(), timeZone: 'US/Eastern' }),
  ).resolves.toMatchObject({
    output: `${String(spelled)}\n`,
    status: 'completed',
  });
});

test('a bad zone follows the failure handler and preserves capture-failure precedence', async () => {
  const app = new Application('clock').action(() => undefined);
  const process = mockProcess();
  await expect(
    app.invoke(
      [],
      {},
      {
        failure: (failure) => failure instanceof InputError,
        process,
        timeZone: 'Mars/Olympus',
      },
    ),
  ).resolves.toMatchObject({ exitCode: 2, failure: true, status: 'failed' });
  const unreadable = {
    ...process,
    cwd: () => {
      throw new Error('private reason');
    },
  };
  const outcome = await app.invoke([], {}, { process: unreadable, timeZone: 'Mars/Olympus' });
  expect(outcome).toMatchObject({ exitCode: 1, status: 'failed' });
});

test('only an explicit nested zone forces a lazy parent-zone read for declared-value reuse', async () => {
  let reads = 0;
  const handle = {
    ...mockProcess(),
    get timeZone() {
      reads += 1;
      return 'UTC';
    },
  };
  const leaf = new Application('clock')
    .command(new Command('leaf').action(() => undefined))
    .action(async ({ invoke }) => {
      const first = await invoke(['leaf'], {});
      expect(first.status).toBe('completed');
      expect(reads).toBe(0);
      const changed = await invoke(['leaf'], {}, { timeZone: 'Asia/Tokyo' });
      expect(changed.status).toBe('completed');
      expect(reads).toBe(1);
    });
  await expect(leaf.invoke([], {}, { process: handle })).resolves.toMatchObject({
    status: 'completed',
  });
});
