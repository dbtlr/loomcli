import { urlIssue, urlSchemeIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { fault } from './faults.js';
import { reject } from './issues.js';
import { urlProtocols } from './rules.js';
import { schemePattern, uriPattern } from './uri-grammar.js';

interface UrlOptions {
  protocols?: readonly [string, ...string[]];
}

const notFound = -1;

/** The `protocols` a `url()` call declares, each a scheme name; a fault marks the entry. */
function protocolsOf(options: UrlOptions | undefined): readonly string[] | undefined {
  const protocols = options?.protocols;
  const invalid = protocols?.findIndex((protocol) => !schemePattern.test(protocol)) ?? notFound;
  if (protocols !== undefined && invalid !== notFound) {
    throw fault(
      urlProtocols,
      { arguments: [options], factory: 'url', mark: `0.protocols.${String(invalid)}` },
      {
        correction:
          'List a letter followed by letters, digits, +, -, or ., with no trailing colon.',
        sentence: `url() protocols lists ${JSON.stringify(protocols[invalid])}, which is not a scheme name.`,
      },
    );
  }
  return protocols;
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
  const protocols = protocolsOf(options);
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
