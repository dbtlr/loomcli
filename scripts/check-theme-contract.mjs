// Checks the proposed Loom theme declaration in docs/core.md against the compiler and editor.
// Run after pnpm build: node scripts/check-theme-contract.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const reference = readFileSync(join(root, 'docs/core.md'), 'utf8');
const section = /^### Loom theme\r?\n(?<body>[\s\S]*?)(?=^### |$(?![\s\S]))/mu.exec(reference);
const declaration = /^```ts\r?\n(?<body>[\s\S]*?)^```/mu.exec(section?.groups.body ?? '')?.groups
  .body;
assert.ok(declaration, 'docs/core.md must contain a TypeScript declaration under ### Loom theme.');
const { default: executable } = await import(
  pathToFileURL(join(root, 'node_modules/typescript/lib/getExePath.js')).href
);
const compiler = executable();
const project = mkdtempSync(join(tmpdir(), 'loom-theme-contract-'));
const coreNames = ['dim', 'primary', 'highlight', 'success', 'warning', 'error', 'info'];
const text = `${declaration}
import { Application, style } from '@loomcli/core';
import type { EnvironmentOf, View } from '@loomcli/core';

loomTheme({ /* empty completion */ });
loomTheme({ highlight: style.red, /* remaining completion */ });
const defaults = loomTheme();
const empty = loomTheme({});
const custom = loomTheme({ identifier: style.cyan, absent: undefined, highlight: undefined });
const authored = { identifier: style.cyan, absent: undefined } satisfies LoomThemeOverrides;
const authoredTheme = loomTheme(authored);
const app = new Application('theme-contract', { plugins: [custom] });
declare module '@loomcli/core' {
  interface Register { environment: EnvironmentOf<typeof app> }
}
const customView: View<string> = {
  render: (value, { style }) => style.identifier(style.absent(style.primary(value))),
};
const invalidView: View<string> = {
  // @ts-expect-error Contextual style rejects misspelled custom names.
  render: (value, { style }) => style.identifer(value),
};
// @ts-expect-error Imported style remains independent of Application custom names.
style.identifier('x');

type CoreNames = 'dim' | 'primary' | 'highlight' | 'success' | 'warning' | 'error' | 'info';
type MappingOf<T> = T extends Plugin<{}, infer Mapping> ? Mapping : never;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type AuthoredKeys = Assert<Equal<keyof MappingOf<typeof authoredTheme>, CoreNames | 'identifier' | 'absent'>>;
type DefaultKeys = Assert<Equal<keyof MappingOf<typeof defaults>, CoreNames>>;
type EmptyKeys = Assert<Equal<keyof MappingOf<typeof empty>, CoreNames>>;
type CustomKeys = Assert<Equal<keyof MappingOf<typeof custom>, CoreNames | 'identifier' | 'absent'>>;
type DefaultValue = Assert<Equal<MappingOf<typeof custom>['highlight'], ConcreteStyle>>;
type UndefinedCustomValue = Assert<Equal<MappingOf<typeof custom>['absent'], undefined>>;

// @ts-expect-error Core mappings require concrete styles.
loomTheme({ highlight: style.info });
// @ts-expect-error Custom mappings require concrete styles.
loomTheme({ identifier: style.info });
// @ts-expect-error Custom names cannot shadow concrete helpers.
loomTheme({ red: style.cyan });
// @ts-expect-error Custom names cannot shadow callable members.
loomTheme({ bind: style.cyan });
// @ts-expect-error A mapping cannot contain applied text.
loomTheme({ highlight: style.red('x') });
// @ts-expect-error A mapping cannot contain arbitrary values.
loomTheme({ identifier: 42 });
// @ts-expect-error Null does not remove a named default.
loomTheme({ highlight: null });
`;

try {
  mkdirSync(join(project, 'node_modules/@loomcli'), { recursive: true });
  symlinkSync(join(root, 'packages/core'), join(project, 'node_modules/@loomcli/core'), 'junction');
  writeFileSync(join(project, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(
    join(project, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        exactOptionalPropertyTypes: true,
        module: 'ESNext',
        moduleResolution: 'Bundler',
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: 'ESNext',
        types: [],
      },
      include: ['contract.ts'],
    }),
  );
  const file = join(project, 'contract.ts');
  writeFileSync(file, text);
  const checked = spawnSync(compiler, ['-p', join(project, 'tsconfig.json')], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (checked.error) {
    throw checked.error;
  }
  assert.equal(
    checked.status,
    0,
    `Theme contract type checks failed:\n${checked.stdout}${checked.stderr}`,
  );
  console.log(
    'Types: seven defaults, literal custom names, Application/View propagation, invalid declarations rejected.',
  );
  await checkCompletions(file);
} finally {
  rmSync(project, { force: true, recursive: true });
}

async function checkCompletions(file) {
  const server = spawn(compiler, ['--lsp', '-stdio'], {
    stdio: ['pipe', 'pipe', 'ignore'],
    timeout: 30_000,
  });
  const closed = new Promise((resolve) => server.once('close', resolve));
  const waiting = new Map();
  let sequence = 0;
  let buffer = Buffer.alloc(0);
  const fail = (error) => {
    for (const pending of waiting.values()) {
      pending.reject(error);
    }
    waiting.clear();
  };
  server.on('error', fail);
  server.stdin.on('error', fail);
  server.on('close', (code, signal) =>
    fail(new Error(`TypeScript LSP exited (${code ?? signal}).`)),
  );
  server.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const head = buffer.indexOf('\r\n\r\n');
      if (head === -1) {
        return;
      }
      const length = Number(
        /Content-Length: (?<length>\d+)/u.exec(buffer.subarray(0, head).toString())?.groups.length,
      );
      if (!Number.isSafeInteger(length)) {
        fail(new Error('TypeScript LSP returned an invalid content length.'));
        return;
      }
      const start = head + 4;
      if (buffer.length < start + length) {
        return;
      }
      const message = JSON.parse(buffer.subarray(start, start + length).toString());
      buffer = buffer.subarray(start + length);
      if ('method' in message && 'id' in message) {
        send({ id: message.id, result: message.method === 'workspace/configuration' ? [] : null });
      } else if ('id' in message) {
        const pending = waiting.get(message.id);
        waiting.delete(message.id);
        if (message.error) {
          pending?.reject(new Error(message.error.message));
        } else {
          pending?.resolve(message.result);
        }
      }
    }
  });

  function send(message) {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message });
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }
  function request(method, params) {
    return new Promise((resolve, reject) => {
      if (server.exitCode !== null || server.signalCode !== null) {
        reject(new Error(`TypeScript LSP exited before ${method}.`));
        return;
      }
      const id = ++sequence;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`TypeScript LSP timed out on ${method}.`));
      }, 15_000);
      waiting.set(id, {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
      send({ id, method, params });
    });
  }

  try {
    const uri = pathToFileURL(file).href;
    const projectUri = pathToFileURL(project).href;
    await request('initialize', {
      capabilities: {},
      processId: process.pid,
      rootUri: projectUri,
      workspaceFolders: [{ name: 'theme-contract', uri: projectUri }],
    });
    send({ method: 'initialized', params: {} });
    send({
      method: 'textDocument/didOpen',
      params: { textDocument: { languageId: 'typescript', text, uri, version: 1 } },
    });
    for (const { expected, marker } of [
      { expected: coreNames, marker: '/* empty completion */' },
      {
        expected: coreNames.filter((name) => name !== 'highlight'),
        marker: '/* remaining completion */',
      },
    ]) {
      const index = text.indexOf(marker);
      const before = text.slice(0, index);
      const result = await request('textDocument/completion', {
        position: {
          character: index - before.lastIndexOf('\n') - 1,
          line: before.split('\n').length - 1,
        },
        textDocument: { uri },
      });
      const items = Array.isArray(result) ? result : (result?.items ?? []);
      const labels = items.map((item) => item.label.replace(/\?$/u, '')).toSorted();
      assert.deepEqual(labels, expected.toSorted(), `Unexpected suggestions at ${marker}.`);
      console.log(`Completion ${marker}: ${labels.join(', ')}.`);
    }
  } finally {
    server.kill('SIGKILL');
    await closed;
  }
}
