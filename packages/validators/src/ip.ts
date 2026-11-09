import { ipIssue, ipV4Issue, ipV6Issue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { ipv4Version, readIpAddress } from './ip-address.js';
import type { IpVersion } from './ip-address.js';
import { reject } from './issues.js';

interface IpOptions {
  version?: IpVersion;
}

/** The published schema for the family `version` names, or for both. */
function schemaOf(version: IpVersion | undefined) {
  if (version === undefined) {
    return { type: 'string', anyOf: [{ format: 'ipv4' }, { format: 'ipv6' }] };
  }
  return { type: 'string', format: version === ipv4Version ? 'ipv4' : 'ipv6' };
}

/** The code for the family `version` names, or for both. */
function codeOf(version: IpVersion | undefined) {
  if (version === undefined) {
    return ipIssue;
  }
  return version === ipv4Version ? ipV4Issue : ipV6Issue;
}

/**
 * An IPv4 address in dotted decimal with no leading zero, or an IPv6 address in a text form of
 * RFC 4291 with no zone, output in its canonical form so two spellings of one address compare
 * equal. `version` accepts one family alone.
 */
function ip(options?: IpOptions): Validator<string> {
  const version = options?.version;
  const issue = codeOf(version).issue({});
  return createValidator({
    inputSchema: schemaOf(version),
    parse: (raw): ParseResult<string> => {
      const address = readIpAddress(raw);
      return address !== undefined && (version === undefined || address.version === version)
        ? { value: address.canonical }
        : reject(issue);
    },
  });
}

export { ip };
export type { IpOptions };
