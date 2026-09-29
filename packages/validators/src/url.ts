import { urlIssue, urlSchemeIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { fault, quote, readOptions } from './faults.js';
import { reject } from './issues.js';
import { urlProtocols } from './rules.js';
import { schemePattern, uriPattern } from './uri-grammar.js';

interface UrlOptions {
  protocols?: readonly [string, ...string[]];
}

const empty = 0;

/** The `protocols` a `url()` call declares, checked, and each fault marks it or one entry. */
function protocolsOf(options: unknown, value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const at = (mark: string) => ({ arguments: [options], factory: 'url', mark });
  if (!Array.isArray(value)) {
    throw fault(urlProtocols, at('0.protocols'), {
      correction: 'Supply an array of scheme names.',
      sentence: 'url() protocols is not an array.',
    });
  }
  const items: readonly unknown[] = value;
  if (items.length === empty) {
    throw fault(urlProtocols, at('0.protocols'), {
      correction: 'List at least one scheme.',
      sentence: 'url() protocols is empty.',
    });
  }
  // `Array.from` reads a hole as `undefined`, so a sparse list faults instead of skipping it.
  return Array.from(items, (item, index) => {
    if (typeof item !== 'string' || !schemePattern.test(item)) {
      throw fault(urlProtocols, at(`0.protocols.${String(index)}`), {
        correction:
          'List a letter followed by letters, digits, +, -, or ., with no trailing colon.',
        sentence: `url() protocols lists ${quote(item)}, which is not a scheme name.`,
      });
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
  const protocols = protocolsOf(options, readOptions('url', options).protocols);
  // The WHATWG parser lowercases the scheme and ends `protocol` with a colon.
  const listed = new Set(protocols?.map((protocol) => `${protocol.toLowerCase()}:`));
  const issue = protocols === undefined ? urlIssue.issue({}) : urlSchemeIssue.issue({ protocols });
  return createValidator({
    inputSchema: {
      type: 'string',
      format: 'uri',
      ...(protocols === undefined ? {} : { pattern: schemesPattern(protocols) }),
    },
    parse: (raw): ParseResult<URL> => {
      if (!uriPattern.test(raw) || !URL.canParse(raw)) {
        return reject(issue);
      }
      const parsed = new URL(raw);
      return protocols === undefined || listed.has(parsed.protocol)
        ? { value: parsed }
        : reject(issue);
    },
  });
}

export { url };
export type { UrlOptions };
