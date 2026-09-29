import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  Application,
  DeclarationError,
  diagnosticRule,
  InternalError,
  override,
  plugin,
  UsageError,
} from '@loomcli/core';

const [scenario, build = 'none', ...argv] = process.argv.slice(2);

/** The packet one run reads: none at all, or one that reads the named build. */
const packet = build === 'none' ? {} : { packet: { build } };

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
        app: new Application('probe', packet).action(() => {
          const value = undefined;
          return value.length;
        }),
      };
    }
    case 'thrown-string': {
      return {
        app: new Application('probe', packet).action(() => {
          throw 'a\u2028b';
        }),
      };
    }
    case 'chain': {
      return {
        app: new Application('probe', packet).action(() => {
          throw new Error('Outer.', { cause: new SyntaxError('Inner.') });
        }),
      };
    }
    case 'escaped': {
      return {
        app: new Application('probe', packet).action(() => {
          throw new Error('line\nbreak \u202e bidi \u2028 separator');
        }),
      };
    }
    case 'app-override': {
      return {
        app: new Application('probe', {
          ...packet,
          views: [override(InternalError, { render: () => 'application override\n' })],
        }).action(() => {
          throw new TypeError('Boom.');
        }),
      };
    }
    case 'plugin-override': {
      return {
        app: new Application('probe', { ...packet, plugins: [brandsDefects] }).action(() => {
          throw new TypeError('Boom.');
        }),
      };
    }
    case 'hint': {
      return {
        app: new Application('probe', { ...packet, plugins: [hintPlugin] }).action(() => {
          throw new TypeError('Boom.');
        }),
      };
    }
    case 'build-fault': {
      return { app: new Application('probe', packet) };
    }
    case 'thrown-declaration': {
      return {
        app: new Application('probe', packet).action(() => {
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
          ...packet,
          views: [
            override(UsageError, {
              render: () => {
                throw new Error('View broke.');
              },
            }),
          ],
        })
          .argument('name', { required: true })
          .action(() => undefined),
      };
    }
    case 'broken-hook': {
      return {
        app: new Application('probe', { ...packet, plugins: [brokenHook, hintPlugin] })
          .argument('name', { required: true })
          .action(() => undefined),
      };
    }
    case 'broken-both': {
      return {
        app: new Application('probe', {
          ...packet,
          plugins: [brokenHook],
          views: [
            override(UsageError, {
              render: () => {
                throw new Error('View broke.');
              },
            }),
          ],
        })
          .argument('name', { required: true })
          .action(() => undefined),
      };
    }
    case 'broken-cancelled': {
      const controller = new AbortController();
      return {
        app: new Application('probe', { ...packet, plugins: [brokenHook] }).action(() => {
          controller.abort();
          throw new TypeError('Boom.');
        }),
        signal: controller.signal,
      };
    }
    case 'broken-output': {
      return {
        app: new Application('probe', packet).action(({ out }) => {
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
        app: new Application('probe', packet).action(() => {
          throw forged(['outside (/elsewhere/secret.js:3:5)']);
        }),
        host: { cwd: here, readSource: recorded(() => 'never read') },
      };
    }
    case 'forged-missing': {
      return {
        app: new Application('probe', packet).action(() => {
          throw forged([`missing (${join(here, 'no-such-file.mjs')}:3:5)`]);
        }),
        host: { cwd: here, readSource: recorded(() => undefined) },
      };
    }
    case 'reader-throws': {
      return {
        app: new Application('probe', packet).action(() => {
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
        app: new Application('probe', packet).action(() => {
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
        app: new Application('probe', packet).action(() => {
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
        app: new Application('probe', { ...packet, plugins: [lazy] }).action(() => undefined),
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
        app: new Application('probe', { ...packet, plugins: [twice] }).action(() => undefined),
      };
    }
    case 'unconstructed': {
      return {
        app: new Application('probe', packet).action(() => {
          throw Object.create(InternalError.prototype);
        }),
      };
    }
    case 'result-missing': {
      return {
        app: new Application('probe', packet)
          .result({ views: { plain: { render: (value) => `${JSON.stringify(value)}\n` } } })
          .action(() => undefined),
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
  symlinkSync(real, linked);
  symlinkSync(join(outside, 'secret.js'), join(real, 'escape.js'));
  const captured = { reader: undefined };
  const app = new Application('probe', { packet: { build: 'development' } }).action(({ host }) => {
    captured.reader = host.readSource;
  });
  await app.run({ host: { argv: [], cwd: linked } });
  const read = (path) => captured.reader(path, linked) ?? null;
  const answers = {
    escape: read(join(linked, 'escape.js')),
    outside: read(join(outside, 'secret.js')),
    own: read(join(linked, 'own.js')),
  };
  process.stdout.write(`${JSON.stringify(answers)}\n`);
} else if (scenario === 'packet-mutation') {
  const source = { build: 'development' };
  const app = new Application('probe', { packet: source }).action(() => {
    throw new TypeError('Boom.');
  });
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
    const app = new Application('probe', { packet: packets[scenario] }).action(() => {
      throw new TypeError('Boom.');
    });
    await app.run({ host: { argv: [] } });
  } catch (error) {
    process.stdout.write(`thrown: ${error.sentence}\n`);
  }
} else if (scenario === 'inspect') {
  try {
    new Application('probe', packet).inspect();
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
