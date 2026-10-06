import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  Application,
  DeclarationError,
  diagnosticRule,
  InternalError,
  locate,
  override,
  plugin,
  UsageError,
} from '@loomcli/core';

const [scenario, build = 'none', ...argv] = process.argv.slice(2);

/** The options every probe declares: its description, and no packet or one that reads the build. */
const probe = { description: 'Probe a build.', ...(build === 'none' ? {} : { packet: { build } }) };

const here = fileURLToPath(new URL('.', import.meta.url));

/** A reader that records every path it is asked for, so a test reads whether core called it. */
const asked = [];
function recorded(answer) {
  return (path, cwd) => {
    asked.push(path);
    return answer(path, cwd);
  };
}

/** An Error whose stack is exactly what a thrown value claims, which core must not trust. */
function forged(frames) {
  const error = new Error('Forged.');
  error.stack = ['Error: Forged.', ...frames.map((frame) => `    at ${frame}`)].join('\n');
  return error;
}

const hintPlugin = plugin('@acme/hint', {
  onFailure: () => 'Report this at https://example.com/issues.',
});
const brokenHook = plugin('@acme/broken-hook', {
  onFailure: () => {
    throw new Error('Hook broke.');
  },
});
const brandsDefects = plugin('@acme/brand', {
  views: [override(InternalError, { render: () => 'plugin override\n' })],
});

const retryLimit = diagnosticRule('@acme/retry/retry-limit', {
  explanation: 'The plugin accepts from 0 through 10 retries.',
  headline: 'Retry limit out of range',
});

/** Every scenario's application and the host it runs on. */
function scenarioRun() {
  switch (scenario) {
    case 'type-error': {
      return {
        app: new Application('probe', probe).action(() => {
          const value = undefined;
          return value.length;
        }),
      };
    }
    case 'thrown-string': {
      return {
        app: new Application('probe', probe).action(() => {
          throw 'a\u2028b';
        }),
      };
    }
    case 'chain': {
      return {
        app: new Application('probe', probe).action(() => {
          throw new Error('Outer.', { cause: new SyntaxError('Inner.') });
        }),
      };
    }
    case 'escaped': {
      return {
        app: new Application('probe', probe).action(() => {
          throw new Error('line\nbreak \u202e bidi \u2028 separator');
        }),
      };
    }
    case 'app-override': {
      return {
        app: new Application('probe', {
          ...probe,
          views: [override(InternalError, { render: () => 'application override\n' })],
        }).action(() => {
          throw new TypeError('Boom.');
        }),
      };
    }
    case 'plugin-override': {
      return {
        app: new Application('probe', { ...probe, plugins: [brandsDefects] }).action(() => {
          throw new TypeError('Boom.');
        }),
      };
    }
    case 'hint': {
      return {
        app: new Application('probe', { ...probe, plugins: [hintPlugin] }).action(() => {
          throw new TypeError('Boom.');
        }),
      };
    }
    case 'build-fault': {
      return { app: new Application('probe', probe) };
    }
    case 'thrown-declaration': {
      return {
        app: new Application('probe', probe).action(() => {
          throw new DeclarationError(retryLimit, {
            correction: 'Pass a whole number from 0 through 10.',
            findings: [{ arguments: [50], call: 'retry', mark: '0', path: ['get'] }],
            sentence: 'retry() received 50 retries.',
          });
        }),
      };
    }
    case 'broken-view': {
      return {
        app: new Application('probe', {
          ...probe,
          views: [
            override(UsageError, {
              render: () => {
                throw new Error('View broke.');
              },
            }),
          ],
        })
          .argument('name', { description: 'The name.', required: true })
          .action(() => undefined),
      };
    }
    case 'broken-hook': {
      return {
        app: new Application('probe', { ...probe, plugins: [brokenHook, hintPlugin] })
          .argument('name', { description: 'The name.', required: true })
          .action(() => undefined),
      };
    }
    case 'broken-both': {
      return {
        app: new Application('probe', {
          ...probe,
          plugins: [brokenHook],
          views: [
            override(UsageError, {
              render: () => {
                throw new Error('View broke.');
              },
            }),
          ],
        })
          .argument('name', { description: 'The name.', required: true })
          .action(() => undefined),
      };
    }
    case 'broken-cancelled': {
      const controller = new AbortController();
      return {
        app: new Application('probe', { ...probe, plugins: [brokenHook] }).action(() => {
          controller.abort();
          throw new TypeError('Boom.');
        }),
        signal: controller.signal,
      };
    }
    case 'broken-output': {
      return {
        app: new Application('probe', probe).action(({ out }) => {
          void out.render('x', {
            render: () => {
              throw new Error('Output view broke.');
            },
          });
        }),
      };
    }
    case 'forged-outside': {
      return {
        app: new Application('probe', probe).action(() => {
          throw forged(['outside (/elsewhere/secret.js:3:5)']);
        }),
        host: { cwd: here, readSource: recorded(() => 'never read') },
      };
    }
    case 'forged-missing': {
      return {
        app: new Application('probe', probe).action(() => {
          throw forged([`missing (${join(here, 'no-such-file.mjs')}:3:5)`]);
        }),
        host: { cwd: here, readSource: recorded(() => undefined) },
      };
    }
    case 'reader-throws': {
      return {
        app: new Application('probe', probe).action(() => {
          throw forged([`reader (${join(here, 'builds.mjs')}:3:5)`]);
        }),
        host: {
          cwd: here,
          readSource: recorded(() => {
            throw new Error('Cannot read.');
          }),
        },
      };
    }
    case 'node-modules': {
      return {
        app: new Application('probe', probe).action(() => {
          throw forged([
            `library (${join(here, 'node_modules', 'lib', 'index.js')}:1:1)`,
            `author (${join(here, 'modules', 'source.mjs')}:3:9)`,
          ]);
        }),
        host: {
          cwd: here,
          readSource: recorded((path) =>
            path.endsWith('source.mjs') ? 'one\ntwo\nthree fails here\nfour\nfive\nsix' : undefined,
          ),
        },
      };
    }
    case 'file-url': {
      return {
        app: new Application('probe', probe).action(() => {
          throw forged([`url (${pathToFileURL(join(here, 'modules', 'source.mjs')).href}:2:1)`]);
        }),
        host: { cwd: here, readSource: recorded(() => 'first\nsecond\nthird') },
      };
    }
    case 'loader-rejects': {
      const lazy = plugin('@acme/lazy', {
        middleware: { activate: 'always', load: () => Promise.reject(new Error('Cannot load.')) },
      });
      return {
        app: new Application('probe', { ...probe, plugins: [lazy] }).action(() => undefined),
      };
    }
    case 'next-twice': {
      const twice = plugin('@acme/twice', {
        middleware: {
          activate: 'always',
          load: () =>
            Promise.resolve({
              default: async ({ next }) => {
                await next();
                await next().catch(() => undefined);
              },
            }),
        },
      });
      return {
        app: new Application('probe', { ...probe, plugins: [twice] }).action(() => undefined),
      };
    }
    case 'unconstructed': {
      return {
        app: new Application('probe', probe).action(() => {
          throw Object.create(InternalError.prototype);
        }),
      };
    }
    case 'result-missing': {
      return {
        app: new Application('probe', probe)
          .result({ views: { plain: { render: (value) => `${JSON.stringify(value)}\n` } } })
          .action(() => undefined),
      };
    }
    case 'hook-declaration': {
      const hook = plugin('@acme/hook', {
        onFailure: () => {
          throw new DeclarationError('A sentence-only fault.');
        },
      });
      return {
        app: new Application('probe', { ...probe, plugins: [hook] })
          .argument('name', { description: 'The name.', required: true })
          .action(() => undefined),
      };
    }
    case 'loader-declaration': {
      const lazy = plugin('@acme/lazy', {
        middleware: {
          activate: 'always',
          load: () => {
            throw new DeclarationError(retryLimit, {
              correction: 'Pass a whole number from 0 through 10.',
              findings: [{ arguments: [50], call: 'retry', mark: '0' }],
              sentence: 'retry() received 50 retries.',
            });
          },
        },
      });
      return {
        app: new Application('probe', { ...probe, plugins: [lazy] }).action(() => undefined),
      };
    }
    case 'message-frame': {
      // The message carries a line that reads as a frame, as operator input interpolated into it can.
      const injected = `x\n    at ${join(here, 'secret.txt')}:1:1`;
      return {
        app: new Application('probe', probe).action(() => {
          throw new Error(`Cannot read ${injected}`);
        }),
        host: { cwd: here, readSource: recorded(() => undefined) },
      };
    }
    case 'spaced-frame':
    case 'parenthesized-frame': {
      const directory = scenario === 'spaced-frame' ? 'dir with space' : 'dir (x)';
      return {
        app: new Application('probe', probe).action(() => {
          throw forged([`<anonymous> (${join(here, directory, 'src.mjs')}:3:9)`]);
        }),
        host: {
          cwd: here,
          readSource: recorded(() => 'one\ntwo\nthree fails here\nfour\nfive'),
        },
      };
    }
    case 'revoked-proxy': {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      return {
        app: new Application('probe', probe).action(() => {
          throw proxy;
        }),
      };
    }
    case 'two-defects': {
      const twice = plugin('@acme/twice', {
        middleware: {
          activate: 'always',
          load: () =>
            Promise.resolve({
              default: async ({ next }) => {
                await next();
                await next().catch(() => undefined);
                throw new Error('Middleware broke.');
              },
            }),
        },
      });
      return {
        app: new Application('probe', { ...probe, plugins: [twice] }).action(() => undefined),
      };
    }
    case 'not-a-signal': {
      return {
        app: new Application('probe', probe).action(() => undefined),
        signal: 'not a signal',
      };
    }
    case 'foreign-graph': {
      return {
        app: new Application('probe', probe).action(() => {
          locate(Object.freeze({}), ['']);
        }),
      };
    }
    case 'broken-destination': {
      const stdout = new Writable({
        write(_chunk, _encoding, callback) {
          callback(new Error('The reader went away.'));
        },
      });
      return {
        app: new Application('probe', probe).action(async ({ out }) => {
          await out.print('hello');
        }),
        host: { stdout },
      };
    }
    default: {
      throw new Error(`Unknown scenario ${scenario}.`);
    }
  }
}

if (scenario === 'captured-reader') {
  // The captured reader answers for a link under cwd that points outside it, with cwd itself reached through a link.
  const root = mkdtempSync(join(tmpdir(), 'loom-reader-'));
  const outside = mkdtempSync(join(tmpdir(), 'loom-outside-'));
  const real = join(root, 'real');
  const linked = join(root, 'linked');
  writeFileSync(join(outside, 'secret.js'), 'secret\n');
  mkdirSync(real);
  writeFileSync(join(real, 'own.js'), 'throw new Error("own");\n');
  writeFileSync(join(real, 'large.js'), 'x'.repeat(1024 * 1024 + 1));
  spawnSync('mkfifo', [join(real, 'pipe')]);
  symlinkSync(real, linked);
  symlinkSync(join(outside, 'secret.js'), join(real, 'escape.js'));
  const captured = { reader: undefined };
  const app = new Application('probe', {
    description: 'Probe a build.',
    packet: { build: 'development' },
  }).action(({ host }) => {
    captured.reader = host.readSource;
  });
  await app.run({ host: { argv: [], cwd: linked } });
  const read = (path) => captured.reader(path, linked) ?? null;
  const answers = {
    escape: read(join(linked, 'escape.js')),
    large: read(join(linked, 'large.js')),
    outside: read(join(outside, 'secret.js')),
    own: read(join(linked, 'own.js')),
    pipe: read(join(linked, 'pipe')),
  };
  process.stdout.write(`${JSON.stringify(answers)}\n`);
} else if (scenario === 'linked-cwd') {
  // The author's module lies under a directory the host names through a symbolic link.
  const root = mkdtempSync(join(tmpdir(), 'loom-linked-'));
  const real = join(root, 'real');
  const linked = join(root, 'linked');
  mkdirSync(real);
  writeFileSync(
    join(real, 'fails.mjs'),
    'export function fails() {\n  throw new Error("Linked.");\n}\n',
  );
  symlinkSync(real, linked);
  const { fails } = await import(pathToFileURL(join(linked, 'fails.mjs')).href);
  const app = new Application('probe', {
    description: 'Probe a build.',
    packet: { build: 'development' },
  }).action(fails);
  await app.run({ host: { argv: [], cwd: linked } });
} else if (scenario === 'packet-mutation') {
  const source = { build: 'development' };
  const app = new Application('probe', { description: 'Probe a build.', packet: source }).action(
    () => {
      throw new TypeError('Boom.');
    },
  );
  source.build = 'distributed';
  await app.run({ host: { argv: [] } });
} else if (scenario.startsWith('packet-')) {
  const packets = {
    'packet-extra': { build: 'distributed', channel: 'npm' },
    'packet-missing': {},
    'packet-not-object': 'development',
    'packet-staging': { build: 'staging' },
  };
  try {
    const app = new Application('probe', {
      description: 'Probe a build.',
      packet: packets[scenario],
    }).action(() => {
      throw new TypeError('Boom.');
    });
    await app.run({ host: { argv: [] } });
  } catch (error) {
    // Imported here, so the lines of the defect scenarios above keep the numbers their tests pin.
    const { ruleText } = await import('./rule-text.mjs');
    process.stdout.write(`thrown: ${ruleText(error)}\n`);
  }
} else if (scenario === 'inspect') {
  try {
    new Application('probe', probe).inspect();
  } catch (error) {
    process.stdout.write(`thrown: ${error.name}: ${error.sentence}\n`);
  }
} else {
  const { app, host = {}, signal } = scenarioRun();
  const code = await app.run({ host: { argv, ...host }, ...(signal ? { signal } : {}) });
  process.stdout.write(`resolved:${code}\n`);
  if (asked.length > 0) {
    process.stdout.write(`asked:${asked.join(',')}\n`);
  }
}
