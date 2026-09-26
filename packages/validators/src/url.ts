import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { fault, quote, readOptions } from './faults.js';
import { listing, reject } from './issues.js';
import { schemePattern, uriPattern } from './uri-grammar.js';

interface UrlOptions {
  protocols?: readonly [string, ...string[]];
}

const empty = 0;

function protocolsOf(value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw fault('url() protocols is not an array. Supply an array of scheme names.');
  }
  const items: readonly unknown[] = value;
  if (items.length === empty) {
    throw fault('url() protocols is empty. List at least one scheme.');
  }
  return items.map((item) => {
    if (typeof item !== 'string' || !schemePattern.test(item)) {
      throw fault(
        `url() protocols lists ${quote(item)}, which is not a scheme name. List a letter followed by letters, digits, +, -, or ., with no trailing colon.`,
      );
    }
    return item;
  });
}

/**
 * One scheme as a case-free pattern: each letter as a two-case class, `+` and `.` escaped.
 * A hyphen stays bare, because the `u` flag JSON Schema patterns use refuses `\-` outside a class.
 */
function spellScheme(scheme: string): string {
  return scheme
    .replaceAll(/[+.]/gu, String.raw`\$&`)
    .replaceAll(/[A-Za-z]/gu, (letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`);
}

/** The pattern that publishes a scheme list, anchored at the start and ending at the colon. */
function schemesPattern(protocols: readonly string[]): string {
  return `^(?:${protocols.map((protocol) => spellScheme(protocol)).join('|')}):`;
}

/** An absolute RFC 3986 URI that the WHATWG parser also reads, optionally with a listed scheme. */
function url(options?: UrlOptions): Validator<URL> {
  const protocols = protocolsOf(readOptions('url', options).protocols);
  // The WHATWG parser lowercases the scheme and ends `protocol` with a colon.
  const listed = new Set(protocols?.map((protocol) => `${protocol.toLowerCase()}:`));
  const sentence =
    protocols === undefined
      ? 'Expected an absolute URL, such as https://example.com.'
      : `Expected an absolute URL with the scheme ${listing(protocols)}.`;
  return createValidator({
    inputSchema: {
      type: 'string',
      format: 'uri',
      ...(protocols === undefined ? {} : { pattern: schemesPattern(protocols) }),
    },
    parse: (raw): ParseResult<URL> => {
      if (!uriPattern.test(raw) || !URL.canParse(raw)) {
        return reject(sentence);
      }
      const parsed = new URL(raw);
      return protocols === undefined || listed.has(parsed.protocol)
        ? { value: parsed }
        : reject(sentence);
    },
  });
}

export { url };
export type { UrlOptions };
