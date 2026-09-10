import { appendFileSync, readFileSync } from 'node:fs';

/**
 * Records each plugin middleware module one invocation evaluates, so a test shows which
 * implementations the chain loaded and which it never reached. The marks file arrives in the
 * environment, so an invocation without one registers nothing and loads modules as it always does.
 */
const marks = process.env.LOOM_FIXTURE_MARKS;

/** The shipped middleware modules, whose parent directory names the plugin that loaded. */
const middleware = /[/\\]dist[/\\]src[/\\](?<plugin>[^/\\]+)[/\\]middleware\.js$/u;

function record(path) {
  const found = middleware.exec(path);
  if (found?.groups) {
    appendFileSync(marks, `loaded:${found.groups.plugin}\n`);
  }
}

/** Bun answers a module load with the module's own text, so the hook reads the file it records. */
function registerBun(bun) {
  bun.plugin({
    name: 'loom-record-loads',
    setup(build) {
      build.onLoad({ filter: middleware }, (args) => {
        record(args.path);
        return { contents: readFileSync(args.path, 'utf8'), loader: 'js' };
      });
    },
  });
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
