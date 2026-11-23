import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * Starts the built bin behind a hook that records each file of the bundle the run loads, by path,
 * one per line in the file `LOOM_FIXTURE_MARKS` names. A test reads the source modules each loaded
 * file holds from the path Bun writes above each module's code.
 */

const marks = process.env.LOOM_FIXTURE_MARKS;

/** A file of the bundle the build writes: the entry, the application module, or a chunk. */
const bundled = /[/\\]dist[/\\][^/\\]+\.js$/u;

/** A loaded module's file path, from the path Bun passes or the URL Node passes. */
function pathOf(location) {
  return location.startsWith('file:') ? fileURLToPath(location) : location;
}

function record(location) {
  const path = pathOf(location);
  if (marks && bundled.test(path)) {
    appendFileSync(marks, `${path}\n`);
  }
}

const bun = globalThis.Bun;
if (bun) {
  // Bun answers a module load with the module's own text, so the hook reads the file it records.
  bun.plugin({
    name: 'loom-record-bundle-loads',
    setup(build) {
      build.onLoad({ filter: bundled }, (args) => {
        record(args.path);
        return { contents: readFileSync(args.path, 'utf8'), loader: 'js' };
      });
    },
  });
} else {
  const { registerHooks } = await import('node:module');
  registerHooks({
    load(url, context, next) {
      record(url);
      return next(url, context);
    },
  });
}

await import('../../dist/main.js');
