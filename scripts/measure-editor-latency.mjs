// Measures editor responsiveness at an ActionHandler site by driving the TypeScript LSP server.
// Usage: node scripts/measure-editor-latency.mjs [file] [needle]
// The file defaults to textstat's extracted action.
// The needle is the text whose position the server is asked about.
// The report lists cold and warm hover, completion, and diagnostic times in milliseconds.
// It ends with the type and instantiation counts and the check time of the file's project.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { default: executable } = await import(
  pathToFileURL(join(root, 'node_modules/typescript/lib/getExePath.js')).href
);
const compiler = executable();
const file = resolvePath(root, process.argv[2] ?? 'examples/textstat/src/count-files.ts');
const needle = process.argv[3] ?? 'out.results(';
const project = nearestProject(dirname(file));
const uri = pathToFileURL(file).href;

function nearestProject(directory) {
  if (existsSync(join(directory, 'tsconfig.json'))) {
    return directory;
  }
  const parent = dirname(directory);
  if (parent === directory) {
    throw new Error(`No tsconfig.json above ${file}.`);
  }
  return nearestProject(parent);
}

const text = readFileSync(file, 'utf8');
const index = text.indexOf(needle);
if (index === -1) {
  throw new Error(`"${needle}" is not in ${file}.`);
}
const before = text.slice(0, index);
const line = before.split('\n').length - 1;
const character = index - before.lastIndexOf('\n') - 1;
const at = { character, line };
// The completion point sits right after the needle's last dot, so the member list is what the editor shows.
// A needle with no dot is completed at its end.
const dot = needle.lastIndexOf('.');
const member = { character: character + (dot === -1 ? needle.length : dot + 1), line };

// The server logs a cancelled context on exit, which is noise here, so its stderr is dropped.
// A server that stalls is killed after the timeout, so a hung measurement fails instead of waiting.
const server = spawn(compiler, ['--lsp', '-stdio'], {
  stdio: ['pipe', 'pipe', 'ignore'],
  timeout: 120_000,
});
let sequence = 0;
const waiting = new Map();
let buffer = Buffer.alloc(0);
server.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const head = buffer.indexOf('\r\n\r\n');
    if (head === -1) {
      return;
    }
    const length = Number(
      /Content-Length: (?<length>\d+)/.exec(buffer.subarray(0, head).toString()).groups.length,
    );
    const start = head + 4;
    if (buffer.length < start + length) {
      return;
    }
    const message = JSON.parse(buffer.subarray(start, start + length).toString());
    buffer = buffer.subarray(start + length);
    if (process.env.LATENCY_DEBUG) {
      console.error('<-', JSON.stringify(message).slice(0, 300));
    }
    // The server registers watchers and asks for settings through requests of its own.
    // Each needs a reply before it serves the next request, so answer with nothing.
    if ('method' in message && 'id' in message) {
      const result = message.method === 'workspace/configuration' ? [] : null;
      send({ id: message.id, result });
    } else if ('id' in message && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    }
  }
});

function send(message) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  if (process.env.LATENCY_DEBUG) {
    console.error('->', body.slice(0, 300));
  }
  server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function notify(method, params) {
  send({ method, params });
}

function request(method, params) {
  sequence += 1;
  const id = sequence;
  const started = performance.now();
  return new Promise((resolve, reject) => {
    // A server that exits before replying settles the request instead of leaving it waiting.
    const onClose = (code, signal) => {
      reject(new Error(`The server exited (${code ?? signal}) before replying to ${method}.`));
    };
    server.once('close', onClose);
    waiting.set(id, (response) => {
      server.removeListener('close', onClose);
      if (response.error) {
        reject(new Error(`${method}: ${response.error.message}`));
        return;
      }
      resolve({ elapsed: performance.now() - started, result: response.result });
    });
    send(params === undefined ? { id, method } : { id, method, params });
  });
}

async function timed(label, method, params) {
  const { elapsed } = await request(method, params);
  return [label, elapsed];
}

const document = { uri };
const rows = [];
await request('initialize', {
  capabilities: { textDocument: { diagnostic: {} } },
  processId: process.pid,
  rootUri: pathToFileURL(project).href,
  workspaceFolders: [{ name: 'project', uri: pathToFileURL(project).href }],
});
notify('initialized', {});
notify('textDocument/didOpen', {
  textDocument: { languageId: 'typescript', text, uri, version: 1 },
});
rows.push(
  await timed('hover cold', 'textDocument/hover', { position: at, textDocument: document }),
);
rows.push(
  await timed('completion cold', 'textDocument/completion', {
    position: member,
    textDocument: document,
  }),
);
rows.push(await timed('diagnostics cold', 'textDocument/diagnostic', { textDocument: document }));
// One edit and its undo invalidate the checker the way a keystroke does.
// The warm numbers measure what an author typing inside the handler waits for.
notify('textDocument/didChange', {
  contentChanges: [{ range: { end: at, start: at }, text: ' ' }],
  textDocument: { uri, version: 2 },
});
notify('textDocument/didChange', {
  contentChanges: [{ range: { end: { character: character + 1, line }, start: at }, text: '' }],
  textDocument: { uri, version: 3 },
});
rows.push(
  await timed('hover warm', 'textDocument/hover', { position: at, textDocument: document }),
);
rows.push(
  await timed('completion warm', 'textDocument/completion', {
    position: member,
    textDocument: document,
  }),
);
rows.push(await timed('diagnostics warm', 'textDocument/diagnostic', { textDocument: document }));
await request('shutdown');
send({ method: 'exit' });

const diagnostics = spawnSync(
  compiler,
  ['-p', join(project, 'tsconfig.json'), '--noEmit', '--extendedDiagnostics'],
  { encoding: 'utf8' },
);
for (const name of ['Types', 'Instantiations', 'Check time']) {
  const match = new RegExp(`^${name}:\\s+(\\S+)`, 'm').exec(diagnostics.stdout);
  rows.push([`tsc ${name.toLowerCase()}`, match === null ? 'unavailable' : match[1]]);
}

console.log(`${file}:${line + 1}:${character + 1}`);
for (const [label, value] of rows) {
  console.log(
    `${label.padEnd(20)} ${typeof value === 'number' ? `${value.toFixed(1)} ms` : value}`,
  );
}
