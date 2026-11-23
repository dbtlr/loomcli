import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

/*
 * Starts jsonkit's built bundle under Node behind a hook that records each file of the bundle the
 * run loads, by path, one per line in the file `LOOM_FIXTURE_MARKS` names. When the process exits
 * it adds the line `node:crypto` if the run loaded that built-in by any route. A test reads the
 * source modules each loaded file holds from the path Bun writes above each module's code.
 */

const marks = process.env.LOOM_FIXTURE_MARKS;

/** A file of the bundle the build writes: the entry, the application module, or a chunk. */
const bundled = /[/\\]dist[/\\][^/\\]+\.js$/u;

registerHooks({
  load(url, context, next) {
    if (marks && url.startsWith('file:') && bundled.test(url)) {
      appendFileSync(marks, `${fileURLToPath(url)}\n`);
    }
    return next(url, context);
  },
});

// Node lists every built-in it has loaded, by a static import or by process.getBuiltinModule alike.
process.on('exit', () => {
  if (marks && process.moduleLoadList.includes('NativeModule crypto')) {
    appendFileSync(marks, 'node:crypto\n');
  }
});

await import('../../dist/main.js');
