import { routedSubject } from './errors.js';
import { glyph } from './glyphs.generated.js';
import type { ViewContext } from './types.js';
import { view } from './view.js';
import type { AnyDeclaredView, DeclaredView } from './view.js';

/**
 * The identity prefix core's own views take, the package name by the plugin-identity convention.
 * Core compiles from `src` alone, so the name is spelled here rather than read from the manifest.
 */
const core = '@loomcli/core';

/** The five semantic methods, each with the glyph and the style token its lane carries. */
type Lane = 'error' | 'info' | 'print' | 'success' | 'warn';

/** The glyph and style name one lane marks its first line with; `warn` marks it `warning`. */
type Mark = 'error' | 'info' | 'success' | 'warning';

/**
 * The default function of a marked lane: the matching glyph and one space before the first line,
 * and continuation lines indented by the measured gutter without repeating the glyph. The
 * semantic method appends the newline, so the view returns none.
 */
function marked(mark: Mark): (message: string, context: ViewContext) => string {
  return (message, context) => {
    const glyphText = glyph[mark];
    const gutter = ' '.repeat(context.width(glyphText) + 1);
    return `${context.style[mark](glyphText)} ${message.replace(/(?<newline>\r?\n)(?!$)/gu, `$<newline>${gutter}`)}`;
  };
}

/** One lane view over the original message string, line breaks and authored styles included. */
function lane(name: Lane, render: (message: string, context: ViewContext) => string) {
  return view<string>(`${core}/lanes/${name}`, { render });
}

/**
 * The five lane views core declares, one per semantic method. An application replaces the function
 * of any of them through `views`, and the replacement owns the gutter the default supplies.
 */
const lanes: Readonly<Record<Lane, DeclaredView<string>>> = {
  error: lane('error', marked('error')),
  info: lane('info', marked('info')),
  print: lane('print', (message) => message),
  success: lane('success', marked('success')),
  warn: lane('warn', marked('warning')),
};

/**
 * What one sequence that stopped early reports: the Command it belongs to, the rows its source
 * produced before the stop, and the rows core wrote. `head` is no row, so it is not counted.
 */
interface IncompleteResult {
  path: readonly string[];
  yielded: number;
  written: number;
}

/**
 * The line a sequence writes on stderr when it stopped before its end, so an empty result and a
 * truncated one never read alike. An override that returns the empty string silences it.
 */
const incompleteResult: DeclaredView<IncompleteResult> = view<IncompleteResult>(
  `${core}/results/incomplete`,
  {
    render: ({ path, written, yielded }) =>
      `Output is incomplete: ${routedSubject(path)} stopped after ${yielded} rows, ${written} written.\n`,
  },
);

/** Every view core declares, so one build register holds their identities from the start. */
const coreViews: readonly AnyDeclaredView[] = [...Object.values(lanes), incompleteResult];

export type { IncompleteResult, Lane };
export { coreViews, incompleteResult, lanes };
