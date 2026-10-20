import { routedSubject } from './errors.js';
import { glyph } from './glyphs.generated.js';
import type { ViewContext } from './types.js';
import { view } from './view.js';
import type { AnyDeclaredView, DeclaredView } from './view.js';

/**
 * The identity prefix core's own views take, the package name by the plugin identity convention.
 * Core compiles from `src` alone, so the name is spelled here rather than read from the manifest.
 */
const core = '@loomcli/core';

/** The seven semantic methods, each naming the lane view it renders through. */
type Lane = 'debug' | 'error' | 'info' | 'print' | 'success' | 'trace' | 'warn';

/** The glyph and style name one lane marks its first line with; `warn` marks it `warning`. */
type Mark = 'error' | 'info' | 'success' | 'warning';

/**
 * The message laid out right of a gutter `width` columns wide: on a terminal its tabs expand to
 * spaces first, so the gutter cannot move a tab stop, and it wraps at the columns right of the
 * gutter when any are left, each continuation line indented under the message. Off a terminal it
 * is unchanged.
 */
function underGutter(message: string, context: ViewContext, width: number): string {
  const gutter = ' '.repeat(width);
  const room = context.columns === undefined ? 0 : context.columns - width;
  const laid = context.columns === undefined ? message : context.expandTabs(message);
  const wrapped = room > 0 ? context.wrap(laid, room) : laid;
  return wrapped.replace(/(?<newline>\r?\n)(?!$)/gu, `$<newline>${gutter}`);
}

/**
 * The default function of a marked lane: the matching glyph and one space before the first line,
 * and continuation lines indented by the measured gutter without repeating the glyph. The semantic
 * method appends the newline, so the view returns none.
 */
function marked(mark: Mark): (message: string, context: ViewContext) => string {
  return (message, context) => {
    const glyphText = glyph[mark];
    const body = underGutter(message, context, context.width(glyphText) + 1);
    return `${context.style[mark](glyphText)} ${body}`;
  };
}

/** How one detail lane draws its gutter: the spaces before its glyph, the glyph, and its fade. */
interface DetailGutter {
  readonly indent: number;
  readonly glyph: 'lineVerticalDashed0' | 'pointerSmall';
  readonly fade: (style: ViewContext['style']) => (text: string) => string;
}

/**
 * The default function of a detail lane, debug or trace: the gutter's indent, its glyph, and one
 * space before the first line, continuation lines indented under the message, and the glyph and
 * the message both in the gutter's fade, so the line reads quieter than info.
 */
function detail(gutter: DetailGutter): (message: string, context: ViewContext) => string {
  return (message, context) => {
    const glyphText = glyph[gutter.glyph];
    const fade = gutter.fade(context.style);
    const body = underGutter(message, context, gutter.indent + context.width(glyphText) + 1);
    return `${' '.repeat(gutter.indent)}${fade(glyphText)} ${fade(body)}`;
  };
}

/** One lane view over the original message string, line breaks and authored styles included. */
function lane(name: Lane, render: (message: string, context: ViewContext) => string) {
  return view<string>(`${core}/lanes/${name}`, { render });
}

/**
 * The seven lane views core declares, one per semantic method. An application replaces the
 * function of any of them through `views`, and the replacement owns the gutter the default
 * supplies. A trace line nests one step under a debug line and fades past it, `faint` over `dim`.
 */
const lanes: Readonly<Record<Lane, DeclaredView<string>>> = {
  debug: lane('debug', detail({ fade: (style) => style.dim, glyph: 'pointerSmall', indent: 0 })),
  error: lane('error', marked('error')),
  info: lane('info', marked('info')),
  print: lane('print', (message) => message),
  success: lane('success', marked('success')),
  trace: lane(
    'trace',
    detail({ fade: (style) => style.dim.faint, glyph: 'lineVerticalDashed0', indent: 2 }),
  ),
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
