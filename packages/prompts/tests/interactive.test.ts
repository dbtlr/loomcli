import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { terminal } from './terminal.js';

test.skipIf(process.platform === 'win32')(
  'text replaces its default hint and leaves one answered line in a real terminal',
  async () => {
    const tty = terminal('text', { NO_COLOR: '1' });
    try {
      await expect(tty.expect('Service port*4317')).resolves.toContain('4317');
      tty.send(String.raw`8080\r`);
      const result = await tty.expect('EXIT:0 cooked:true');
      expect(result).toContain('Service port · 8080');
      expect(result).toContain('ANSWER:"8080"');
    } finally {
      await tty.close();
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'secret never sends entered text to a frame or its answered line',
  async () => {
    const tty = terminal('secret', { NO_COLOR: '1' });
    try {
      await tty.expect('Postgres URL');
      tty.send(String.raw`password-sentinel\r`);
      const result = await tty.expect('EXIT:0 cooked:true');
      expect(result).not.toContain('password-sentinel');
      expect(result).toContain('SECRET:true');
      expect(result).not.toContain('hidden');
    } finally {
      await tty.close();
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'confirm retries invalid input and retains typed-ahead answers for the next question',
  async () => {
    const tty = terminal('confirm', { NO_COLOR: '1' });
    try {
      await tty.expect('Install service?*[y/n]');
      tty.send(String.raw`x\r`);
      await tty.expect('Type y or n.');
      tty.send(String.raw`\x7fyes\rNO\r`);
      const result = await tty.expect('EXIT:0 cooked:true');
      expect(result).toContain('Install service? · yes');
      expect(result).toContain('Continue? · no');
      expect(result).toContain('ANSWERS:[true,false]');
    } finally {
      await tty.close();
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'select scrolls seven choices without wrapping and honors a matching default',
  async () => {
    const tty = terminal('select', { NO_COLOR: '1' });
    try {
      await tty.expect('↓ 3 more');
      tty.send(String.raw`\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B`);
      await tty.expect('↑ 3 more');
      tty.send(String.raw`\r`);
      const result = await tty.expect('EXIT:0 cooked:true');
      expect(result).toContain('Backend · choice-9');
      expect(result).toContain('ANSWER:"choice-9"');
    } finally {
      await tty.close();
    }
  },
);

test
  .skipIf(process.platform === 'win32')
  .each([
    'text',
    'secret',
    'confirm',
    'select',
    'text-signals',
    'secret-signals',
    'confirm-signals',
    'select-signals',
  ])('Ctrl-C cancels %s, shows the cursor, and restores cooked mode', async (kind) => {
  const tty = terminal(kind, { NO_COLOR: '1' });
  try {
    await tty.expect(
      {
        confirm: 'Install service?',
        secret: 'Postgres URL',
        select: 'Backend',
        text: 'Service port',
      }[kind.replace(/-signals$/u, '')] ?? '',
    );
    tty.send(String.raw`\x03`);
    const result = await tty.expect('EXIT:130 cooked:true');
    expect(result).toContain('cancelled');
    expect(result).toContain('\u001b[?25h');
  } finally {
    await tty.close();
  }
});

test.skipIf(process.platform === 'win32').each([
  ['blank', String.raw`\r`, '""'],
  ['default', String.raw`\r`, '"4317"'],
  ['clear', String.raw`xx\x7f\x7f\r`, '"4317"'],
  ['confirm-no', String.raw`\r`, 'false'],
])('Enter submits the agreed default or blank value: %s', async (scenario, keys, answer) => {
  const tty = terminal(scenario, { NO_COLOR: '1' });
  try {
    await tty.expect(scenario === 'confirm-no' ? 'Install service?' : 'Service port');
    tty.send(keys);
    await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain(`ANSWER:${answer}`);
  } finally {
    await tty.close();
  }
});

test.skipIf(process.platform === 'win32')(
  'text retries entered answers and applies its own transformation',
  async () => {
    const tty = terminal('retry', { NO_COLOR: '1' });
    try {
      await tty.expect('Service port');
      tty.send(String.raw`bad\r`);
      await tty.expect('Use digits.');
      tty.send(String.raw`\x7f\x7f\x7f8080\r`);
      await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWER:8080');
    } finally {
      await tty.close();
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'a chunk typed ahead answers text then confirm',
  async () => {
    const tty = terminal('typeahead', { NO_COLOR: '1' });
    try {
      await tty.expect('Service port');
      tty.send(String.raw`8080\ryes\r`);
      await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWERS:["8080",true]');
    } finally {
      await tty.close();
    }
  },
);

test.skipIf(process.platform === 'win32').each([
  [{}, '5000', '5000'],
  [{ PROMPT_PORT: '06000' }, '06000', '6000'],
  [{ PROMPT_ARGV: '["--port","07000"]', PROMPT_PORT: '6000' }, '07000', '7000'],
])(
  'an asked link uses raw supplied input before the question default: %j',
  async (env, hint, answer) => {
    const tty = terminal('linked', { NO_COLOR: '1', ...env });
    try {
      await tty.expect(`Service port*${hint}`);
      tty.send(String.raw`\r`);
      await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain(`ANSWER:${answer}`);
    } finally {
      await tty.close();
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'a skipped supplied link prints no question or answered line',
  async () => {
    const tty = terminal('skip', { NO_COLOR: '1', PROMPT_PORT: '6000' });
    try {
      const result = await tty.expect('EXIT:0 cooked:true');
      expect(result).toContain('ANSWER:6000');
      expect(result).not.toContain('Service port');
    } finally {
      await tty.close();
    }
  },
);

test
  .skipIf(process.platform === 'win32')
  .each(['text', 'secret', 'confirm', 'select', 'secret-signals'])(
  'Ctrl-D on empty %s cancels the run',
  async (kind) => {
    const tty = terminal(kind, { NO_COLOR: '1' });
    try {
      await tty.expect(
        {
          confirm: 'Install service?',
          secret: 'Postgres URL',
          'secret-signals': 'Postgres URL',
          select: 'Backend',
          text: 'Service port',
        }[kind] ?? '',
      );
      tty.send(String.raw`\x04`);
      await expect(tty.expect('EXIT:130 cooked:true')).resolves.toContain('cancelled');
    } finally {
      await tty.close();
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'a configuration file supplies the raw prefill before the option transformation',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-prompt-config-'));
    const path = join(directory, 'settings.json');
    await writeFile(path, '{"port":"006050"}');
    const tty = terminal('linked', {
      NO_COLOR: '1',
      PROMPT_ARGV: JSON.stringify(['--config', path]),
    });
    try {
      await tty.expect('Service port*006050');
      tty.send(String.raw`\r`);
      await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWER:6050');
    } finally {
      await tty.close();
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'piping stdout still asks while the pipe contains only action output',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-prompt-stdout-'));
    const path = join(directory, 'stdout.txt');
    const tty = terminal('text', { NO_COLOR: '1', PROMPT_STDOUT: path }, { pipeStdout: true });
    try {
      await tty.expect('Service port*4317');
      tty.send(String.raw`\r`);
      await tty.expect('EXIT:0 cooked:true');
    } finally {
      await tty.close();
    }
    try {
      const output = await readFile(path, 'utf8');
      expect(output).toBe('ANSWER:"4317"\nEXIT:0 cooked:true\n');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test.skipIf(process.platform === 'win32').each([
  [String.raw`ab\x1b\x1b[A\r`, 'ab'],
  [String.raw`\x1bx\r`, 'x'],
  [String.raw`ab\x1b\r`, 'ab'],
])('Escape ignores itself without consuming the following key: %s', async (keys, answer) => {
  const tty = terminal('blank', { NO_COLOR: '1' });
  try {
    await tty.expect('Service port');
    tty.send(keys);
    await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain(
      `ANSWER:${JSON.stringify(answer)}`,
    );
  } finally {
    await tty.close();
  }
});
