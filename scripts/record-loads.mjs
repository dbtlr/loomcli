import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Records each plugin middleware module one invocation evaluates, so a test shows which
 * implementations the chain loaded and which it never reached. The marks file arrives in the
 * environment, so an invocation without one registers nothing and loads modules as it always does.
 */
const marks = process.env.LOOM_FIXTURE_MARKS;

/** The shipped middleware modules, whose parent directory names the plugin that loaded. */
const middleware = /[/\\]dist[/\\]src[/\\](?<plugin>[^/\\]+)[/\\]middleware\.js$/u;

/**
 * A chunk a bundle split out, which holds the modules one dynamic import reached. Bun writes the
 * path of each module it bundles in a comment above that module's code.
 */
const chunk = /[/\\]dist[/\\]chunk-[^/\\]+\.js$/u;
const bundledMiddleware = /^\/\/ .*dist\/src\/(?<plugin>[^/]+)\/middleware\.js$/gmu;

/** A loaded module's file path, from the path Bun passes or the URL Node passes. */
function pathOf(location) {
  return location.startsWith('file:') ? fileURLToPath(location) : location;
}

function record(location) {
  const found = middleware.exec(location);
  if (found?.groups) {
    appendFileSync(marks, `loaded:${found.groups.plugin}\n`);
    return;
  }
  if (chunk.test(location)) {
    for (const bundled of readFileSync(pathOf(location), 'utf8').matchAll(bundledMiddleware)) {
      appendFileSync(marks, `loaded:${bundled.groups.plugin}\n`);
    }
  }
}

/** Bun answers a module load with the module's own text, so the hook reads the file it records. */
function registerBun(bun) {
  for (const filter of [middleware, chunk]) {
    bun.plugin({
      name: 'loom-record-loads',
      setup(build) {
        build.onLoad({ filter }, (args) => {
          record(args.path);
          return { contents: readFileSync(args.path, 'utf8'), loader: 'js' };
        });
      },
    });
  }
}

/** Node reports each module it loads to a synchronous hook, which passes the load along. */
async function registerNode() {
  const { registerHooks } = await import('node:module');
  registerHooks({
    load(url, context, next) {
      record(url);
      return next(url, context);
    },
  });
}

/** Registers the hook the runtime provides, and nothing at all without a marks file. */
export async function recordLoads() {
  if (!marks) {
    return;
  }
  const bun = globalThis.Bun;
  if (bun) {
    registerBun(bun);
    return;
  }
  await registerNode();
}
