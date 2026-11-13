import { hostIssue, hostOrIpIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { ipv4Version, ipv6Version, readIpAddress } from './ip-address.js';
import { reject } from './issues.js';

/**
 * The options of `host()`: whether it also accepts an IP address.
 *
 * @public
 */
interface HostOptions {
  /** Whether the validator also accepts an IPv4 address and a bracketed IPv6 address; `false` when omitted. */
  ip?: boolean;
}

/** The longest host name in text form, with no trailing dot, that RFC 1035's 255-octet name holds. */
const longestName = 253;

/** One RFC 1123 label: letters, digits, and hyphens, 1 through 63, with a hyphen at neither end. */
const label = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';

const hostName = new RegExp(String.raw`^${label}(?:\.${label})*$`, 'u');

/**
 * A last label that the WHATWG URL standard's ends-in-a-number rule reads as a number: decimal
 * digits alone, or `0x` or `0X` followed by zero or more hexadecimal digits.
 */
const numericLabel = /^(?:[0-9]+|0[xX][0-9A-Fa-f]*)$/u;

/** An address in brackets, as a URL writes an IPv6 host. */
const brackets = /^\[(?<address>.*)\]$/u;

const lastLabel = -1;

/** A bracketed address as the published pattern admits it, hexadecimal digits, `:`, and `.`. */
const bracketedPattern = String.raw`^\[[0-9A-Fa-f:.]+\]$`;

/** Whether a token is an RFC 1123 host name whose last label is not a number. */
function isHostName(raw: string): boolean {
  return (
    raw.length <= longestName &&
    hostName.test(raw) &&
    !numericLabel.test(raw.split('.').at(lastLabel) ?? '')
  );
}

/**
 * The canonical address a token spells under `ip: true`, an IPv4 address bare and an IPv6
 * address in brackets, as a URL writes each, or undefined.
 */
function addressOf(raw: string): string | undefined {
  const bracketed = brackets.exec(raw)?.groups?.address;
  const address = readIpAddress(bracketed ?? raw);
  const wanted = bracketed === undefined ? ipv4Version : ipv6Version;
  return address?.version === wanted ? address.canonical : undefined;
}

/**
 * An RFC 1123 host name with no trailing dot, output in lowercase. With `ip: true` it also accepts
 * an IPv4 address and an IPv6 address in brackets, output in the canonical form `ip()` writes.
 *
 * @example
 * ```ts
 * import { host } from '@loomcli/validators';
 *
 * const server = host({ ip: true });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#host
 *
 * @public
 */
function host(options?: HostOptions): Validator<string> {
  const withIp = options?.ip === true;
  const issue = withIp ? hostOrIpIssue.issue({}) : hostIssue.issue({});
  return createValidator({
    inputSchema: withIp
      ? {
          type: 'string',
          anyOf: [{ format: 'hostname' }, { format: 'ipv4' }, { pattern: bracketedPattern }],
        }
      : { type: 'string', format: 'hostname' },
    parse: (raw): ParseResult<string> => {
      if (isHostName(raw)) {
        return { value: raw.toLowerCase() };
      }
      const address = withIp ? addressOf(raw) : undefined;
      return address === undefined ? reject(issue) : { value: address };
    },
  });
}

export { host };
export type { HostOptions };
