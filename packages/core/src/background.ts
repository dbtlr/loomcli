/**
 * The run's background: the terminal's background color read as dark or light. Core settles it
 * once per run, and an adaptive theme entry resolves to the side that matches it.
 */
type Background = 'dark' | 'light';

/** What a read of the terminal's replies found so far. */
interface Replies {
  /** The answer the replies give: an OSC 11 color first, then a color-scheme reply. */
  readonly answer: Background | undefined;
  /** Whether the DA1 reply, the sentinel, has arrived, which ends the read. */
  readonly ended: boolean;
  /** Every byte that is not a reply, in arrival order, as a latin1 string. */
  readonly typeahead: string;
}

/**
 * Where each source of the run's background stands when core settles it. `detects` says whether
 * the installed theme holds an adaptive entry or an option carries the background mark, and
 * `colored` whether the run's color is on for stdout or stderr after the color choice.
 */
interface BackgroundSources {
  readonly choice: Background | undefined;
  readonly policy: 'auto' | Background | undefined;
  readonly stated: Background | undefined;
  readonly detects: boolean;
  readonly colored: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** The code points of ESC, which opens every query and reply, and of BEL, which may end OSC 11. */
const escapeCode = 27;
const bellCode = 7;
const escape = String.fromCodePoint(escapeCode);
const bell = String.fromCodePoint(bellCode);

/** The three queries in the order core writes them: OSC 11, the color-scheme query, and DA1. */
const backgroundQuery = `${escape}]11;?${escape}\\${escape}[?996n${escape}[c`;

/** An OSC 11 reply, ended by BEL or ST, whose payload is the first group. */
const colorReply = new RegExp(
  `${escape}\\]11;([^${bell}${escape}]*)(?:${bell}|${escape}\\\\)`,
  'gu',
);

/** A color-scheme reply, `CSI ? 997 ; <n> n`, whose mode is the first group. */
const schemeReply = new RegExp(`${escape}\\[\\?997;(\\d+)n`, 'gu');

/** A Primary Device Attributes reply, `CSI ? <attributes> c`, the read's sentinel. */
const sentinelReply = new RegExp(`${escape}\\[\\?[\\d;]*c`, 'u');

/** One `rgb:` component: 1 to 4 hex digits. */
const component = /^[\da-f]{1,4}$/iu;

/** Each hex digit holds 4 bits, so a component of n digits scales by 16^n - 1. */
const hexBase = 16;

/** The sRGB transfer function's linear segment, its scale, and its power segment's parameters. */
const linearLimit = 0.04045;
const linearScale = 12.92;
const offset = 0.055;
const offsetScale = 1.055;
const gamma = 2.4;

/** The WCAG 2 weights of the linear red, green, and blue channels in relative luminance. */
const redWeight = 0.2126;
const greenWeight = 0.7152;
const blueWeight = 0.0722;

/** A background whose relative luminance is above this reads light, and at it or below, dark. */
const lightAbove = 0.5;

/** The palette indices `COLORFGBG` names for white, the background of a light terminal. */
const lightIndices = new Set(['7', '15']);

/** The color-scheme reply's modes. */
const schemes: Readonly<Record<string, Background>> = { '1': 'dark', '2': 'light' };

/** One channel of an sRGB color, from 0 through 1, made linear. */
function linear(channel: number): number {
  return channel <= linearLimit
    ? channel / linearScale
    : ((channel + offset) / offsetScale) ** gamma;
}

/** The background a relative luminance answers: light above 0.5, and dark otherwise. */
function backgroundOfLuminance(luminance: number): Background {
  return luminance > lightAbove ? 'light' : 'dark';
}

/**
 * The background an OSC 11 payload answers, `rgb:R/G/B` with 1 to 4 hex digits in each component,
 * each scaled by its own width, or `undefined` for any other payload.
 */
function colorAnswer(payload: string): Background | undefined {
  if (!payload.startsWith('rgb:')) {
    return undefined;
  }
  const parts = payload.slice('rgb:'.length).split('/');
  const [red, green, blue, ...rest] = parts.map((part) =>
    component.test(part)
      ? linear(Number.parseInt(part, hexBase) / (hexBase ** part.length - 1))
      : undefined,
  );
  if (red === undefined || green === undefined || blue === undefined || rest.length > 0) {
    return undefined;
  }
  return backgroundOfLuminance(redWeight * red + greenWeight * green + blueWeight * blue);
}

/**
 * What the bytes read so far say, read as latin1: the read ends at the first DA1 reply, the
 * OSC 11 and color-scheme replies before it are removed and answer, an OSC 11 reply that parses
 * winning, and every other byte, before, between, or after the replies, is typeahead.
 */
function readReplies(received: string): Replies {
  const sentinel = sentinelReply.exec(received);
  const before = sentinel === null ? received : received.slice(0, sentinel.index);
  const after = sentinel === null ? '' : received.slice(sentinel.index + sentinel[0].length);
  const colors: (Background | undefined)[] = [];
  const modes: (Background | undefined)[] = [];
  const remaining = before
    .replaceAll(colorReply, (_reply, payload: string) => {
      colors.push(colorAnswer(payload));
      return '';
    })
    .replaceAll(schemeReply, (_reply, mode: string) => {
      modes.push(schemes[mode]);
      return '';
    });
  const answer =
    colors.find((color) => color !== undefined) ?? modes.find((mode) => mode !== undefined);
  return { answer, ended: sentinel !== null, typeahead: remaining + after };
}

/**
 * The background `COLORFGBG` names: light when its last `;`-separated field is 7 or 15, the
 * palette's white, dark for any other field, and `undefined` when it is unset or empty.
 */
function colorFgBg(value: string | undefined): Background | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  return lightIndices.has(value.split(';').at(-1) ?? '') ? 'light' : 'dark';
}

/**
 * Whether the environment lets core query the terminal: a `TERM` that is set, nonempty, and not
 * `dumb`, no GNU screen or Emacs, neither of which passes the query through, and not Windows.
 */
function queryAllowed(
  env: Readonly<Record<string, string | undefined>>,
  platform: string,
): boolean {
  const term = env.TERM ?? '';
  return (
    term !== '' &&
    term !== 'dumb' &&
    (env.STY ?? '') === '' &&
    (env.INSIDE_EMACS ?? '') === '' &&
    platform !== 'win32'
  );
}

/**
 * The run's background, from the first source that answers: the operator's choice, the author's
 * policy, a stated background, and, only when something reads it, `undefined` with color off,
 * dark on the Linux console, the terminal's answer to `query`, then `COLORFGBG`, then `undefined`.
 */
async function settleBackground(
  sources: BackgroundSources,
  query: () => Promise<Background | undefined>,
): Promise<Background | undefined> {
  const { choice, colored, detects, env, policy, stated } = sources;
  const named = choice ?? (policy === 'auto' ? undefined : policy) ?? stated;
  if (named !== undefined || !detects || !colored) {
    return named;
  }
  if (env.TERM === 'linux') {
    return 'dark';
  }
  return (await query()) ?? colorFgBg(env.COLORFGBG);
}

export type { Background, BackgroundSources, Replies };
export {
  backgroundOfLuminance,
  backgroundQuery,
  colorFgBg,
  queryAllowed,
  readReplies,
  settleBackground,
};
