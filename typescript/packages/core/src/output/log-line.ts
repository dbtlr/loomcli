import type { Localize } from '../localization/phrase.js';
import { glyph } from '../style/glyphs.generated.js';
import { escapeText, nowrap } from '../style/style.js';
import { escapeControlCharacters } from '../support/controls.js';
import { underGutter } from './gutter.js';
import { eventPhrases } from './log.js';
import type { JsonValue, LogEvent, LogLevel } from './log.js';
import type { ViewContext } from './types.js';
import { view } from './view.js';
import type { DeclaredView } from './view.js';

/**
 * The levels a log line shows: every level but `fatal`, which only a failure event carries, and a
 * failure event never shows as a log line.
 *
 * @public
 */
type LogLineLevel = Exclude<LogLevel, 'fatal'>;

/**
 * One field a log line trails, because its message does not place it, with its name and its value
 * as marked text, escaped.
 *
 * @public
 * @sealed
 */
interface LogLineField {
  /** The field's name, with its control characters and Loom's markup escaped. */
  readonly name: string;
  /**
   * The field's value as text: a string as written, quoted as JSON when it is empty or holds
   * whitespace, a double quote, or an equals sign, and any other value as JSON, escaped as `name` is.
   * An Error-shaped copy shows only its name and message, never its stack or cause.
   */
  readonly value: string;
}

/**
 * What the log-line view renders for one log event that the run's verbosity shows: its level, its
 * message with each placeholder filled, the fields the message does not place, and the event.
 *
 * @public
 * @sealed
 */
interface LogLine {
  /** The event's level. */
  readonly level: LogLineLevel;
  /**
   * The event's message as marked text: its Message Template placeholders filled from its fields,
   * `{{` and `}}` written as single braces, and every character escaped as `LogLineField` states.
   */
  readonly text: string;
  /** The fields the message does not place, in the order the event holds them. */
  readonly fields: readonly LogLineField[];
  /** The event the line shows, frozen, as every `onLog` hook receives it. */
  readonly event: LogEvent;
}

/**
 * What a message template marks: an escaped brace, `{{` or `}}`, or a named placeholder, `{name}`,
 * whose name follows the Message Templates property name grammar.
 */
const marks = /\{\{|\}\}|\{(?<name>[0-9A-Za-z_]+)\}/gu;

/** A string a trailing field shows without quotes: nonempty, with no whitespace, `"`, or `=`. */
const bare = /^[^\s"=]+$/u;

/** Text as a line shows it: control characters escaped, then Loom's markup. */
function shown(text: string): string {
  return escapeText(escapeControlCharacters(text));
}

/** An Error-shaped copy shows its name and message alone; its record keeps every field. */
function errorText(value: JsonValue): string | undefined {
  if (value !== null && typeof value === 'object' && 'name' in value && 'message' in value) {
    const { name, message } = value;
    if (typeof name === 'string' && typeof message === 'string') {
      return `${name}: ${message}`;
    }
  }
  return undefined;
}

/** A placed value: an Error-shaped copy's name and message, a string as written, or JSON. */
function placedText(value: JsonValue): string {
  return errorText(value) ?? (typeof value === 'string' ? value : JSON.stringify(value));
}

/** A trailing value: an Error-shaped copy's name and message, a bare string, or JSON. */
function trailingText(value: JsonValue): string {
  return (
    errorText(value) ??
    (typeof value === 'string' && bare.test(value) ? value : JSON.stringify(value))
  );
}

/**
 * The text one mark of a template shows: one brace for an escaped brace, the field's value for a
 * placeholder whose field the event holds, which `placed` then names, and the mark as it stands for
 * a placeholder whose field is absent.
 */
function markText(
  mark: RegExpExecArray,
  fields: Readonly<Record<string, JsonValue>>,
  placed: Set<string>,
): string {
  const [written] = mark;
  const name = mark.groups?.name;
  if (name === undefined) {
    return shown(written.charAt(0));
  }
  // A name the fields hold as their own property, never one their prototype answers.
  const value = Object.hasOwn(fields, name) ? fields[name] : undefined;
  if (value === undefined) {
    return shown(written);
  }
  placed.add(name);
  const text = placedText(value);
  return /\s/u.test(text) ? shown(text) : nowrap(shown(text));
}

/**
 * A message with its placeholders filled from `fields`, under the Message Templates standard
 * (messagetemplates.org): `{name}` takes that field's value, `{{` and `}}` write one brace, and any
 * other brace, and a placeholder whose field is absent, is written as it stands. It returns the
 * marked text and the names it placed.
 */
function filled(
  message: string,
  fields: Readonly<Record<string, JsonValue>>,
): { readonly text: string; readonly placed: ReadonlySet<string> } {
  const placed = new Set<string>();
  let text = '';
  let end = 0;
  for (const mark of message.matchAll(marks)) {
    text += shown(message.slice(end, mark.index)) + markText(mark, fields, placed);
    end = mark.index + mark[0].length;
  }
  return { placed, text: text + shown(message.slice(end)) };
}

/**
 * The log line of one event that shows: its template and the fields its call gave as phrases
 * rendered by `localize`, while the event keeps the English template and field values. Core calls
 * it only for an event a log line shows, never a failure event or a `fatal` one.
 */
function logLineOf(
  event: LogEvent,
  showing: { readonly level: LogLineLevel; readonly localize: Localize },
): LogLine {
  const { level, localize } = showing;
  const said = eventPhrases(event);
  const template = said?.template === undefined ? event.message : localize(said.template);
  const localized =
    said === undefined || said.fields.size === 0
      ? event.fields
      : {
          ...event.fields,
          ...Object.fromEntries([...said.fields].map(([name, phrase]) => [name, localize(phrase)])),
        };
  const { placed, text } = filled(template, localized);
  const fields = Object.entries(localized)
    .filter(([name]) => !placed.has(name))
    .map(([name, value]) =>
      Object.freeze({ name: shown(name), value: shown(trailingText(value)) }),
    );
  return Object.freeze({ event, fields: Object.freeze(fields), level, text });
}

/** The style each level's gutter glyph takes. */
function glyphStyle(level: LogLineLevel, style: ViewContext['style']): (text: string) => string {
  const styles: Readonly<Record<LogLineLevel, (text: string) => string>> = {
    debug: style.dim,
    error: style.error,
    info: style.info,
    trace: style.dim.faint,
    warn: style.warning,
  };
  return styles[level];
}

/**
 * The default log line: a trace line nests two spaces in under `glyph.lineVerticalDashed0` and
 * fades whole, `dim.faint`; every other level opens with `glyph.pointerSmall` in its level's style,
 * `dim` for debug, and keeps its message plain, with the fields it trails `dim`. The trailing fields
 * follow the message as `name=value`, each kept on one row, and the line wraps under its gutter as
 * a lane does.
 */
function renderLogLine(line: LogLine, context: ViewContext): string {
  const { style } = context;
  const trace = line.level === 'trace';
  const glyphText = glyph[trace ? 'lineVerticalDashed0' : 'pointerSmall'];
  const indent = trace ? 2 : 0;
  const pairs = line.fields.map(({ name, value }) => nowrap(`${name}=${value}`)).join(' ');
  const trailing = pairs === '' || trace ? pairs : style.dim(pairs);
  const shownText = [line.text, trailing].filter((part) => part !== '').join(' ');
  const body = underGutter(shownText, context, indent + context.width(glyphText) + 1);
  const mark = glyphStyle(line.level, style)(glyphText);
  return `${' '.repeat(indent)}${mark} ${trace ? style.dim.faint(body) : body}`;
}

/**
 * The view core renders a log event through when the run's verbosity shows it: `-v` shows debug and
 * above, and `-vv` adds trace. An application replaces its function through `views`, and a theme
 * restyles the tokens it uses.
 *
 * @example
 * ```ts
 * import { Application, logLine, override } from '@loomcli/core';
 *
 * const app = new Application('stamped', {
 *   views: [
 *     override(logLine, {
 *       render: ({ event, fields, text }, { style }) =>
 *         [style.dim(event.time), text, ...fields.map(({ name, value }) => `${name}=${value}`)].join(' '),
 *     }),
 *   ],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/logging.md#at--v
 * @public
 */
const logLine: DeclaredView<LogLine> = view<LogLine>('@loomcli/core/log/line', {
  render: renderLogLine,
});

export type { LogLine, LogLineField, LogLineLevel };
export { logLine, logLineOf };
