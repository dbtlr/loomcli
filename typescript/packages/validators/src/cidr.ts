import { cidrHostBitsIssue, cidrIssue, cidrV4Issue, cidrV6Issue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { hasNoHostBits, ipv4Version, readIpAddress } from './ip-address.js';
import type { IpAddress, IpVersion } from './ip-address.js';
import { reject } from './issues.js';

/**
 * The options of `cidr()`: which IP family a block may belong to.
 *
 * @public
 */
interface CidrOptions {
  /** The one IP family a block may belong to, `4` or `6`; without it both families are accepted. */
  version?: IpVersion;
}

/**
 * A CIDR block: the network's canonical address and its prefix length.
 *
 * @public
 * @sealed
 */
interface CidrBlock {
  /** The network's address in canonical form, with every bit below the prefix clear. */
  address: string;
  /** The prefix length in bits, from 0 through 32 for IPv4 and 0 through 128 for IPv6. */
  prefix: number;
}

/** An address, `/`, and a prefix length in decimal with no leading zero, at most three digits. */
const block = /^(?<address>[^/]*)\/(?<prefix>0|[1-9][0-9]{0,2})$/u;

/**
 * The published pattern: an address of hexadecimal digits, `:`, and `.`, then a prefix from 0
 * through 128. It states neither the family nor the host bits.
 */
const cidrPattern = '^[0-9A-Fa-f:.]+/(?:12[0-8]|1[01][0-9]|[1-9]?[0-9])$';

/** The code for the family `version` names, or for both. */
function codeOf(version: IpVersion | undefined) {
  if (version === undefined) {
    return cidrIssue;
  }
  return version === ipv4Version ? cidrV4Issue : cidrV6Issue;
}

/** The address and prefix a block token spells, the prefix within its family's bits, or undefined. */
function readBlock(raw: string): { address: IpAddress; prefix: number } | undefined {
  const found = block.exec(raw);
  const address = readIpAddress(found?.groups?.address ?? '');
  const prefix = Number(found?.groups?.prefix);
  return address !== undefined && prefix <= address.bits ? { address, prefix } : undefined;
}

/**
 * An IP network as an address, `/`, and a prefix length, output as the canonical address and the
 * prefix. The address is the network itself, so a bit set below the prefix is rejected with its
 * own sentence. `version` accepts one family alone.
 *
 * @example
 * ```ts
 * import { cidr } from '@loomcli/validators';
 *
 * const network = cidr({ version: 4 });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#cidr
 *
 * @public
 */
function cidr(options?: CidrOptions): Validator<CidrBlock> {
  const version = options?.version;
  const issue = codeOf(version).issue({});
  const hostBitsIssue = cidrHostBitsIssue.issue({});
  return createValidator({
    inputSchema: { type: 'string', pattern: cidrPattern },
    parse: (raw): ParseResult<CidrBlock> => {
      const read = readBlock(raw);
      if (read === undefined || (version !== undefined && read.address.version !== version)) {
        return reject(issue);
      }
      const { address, prefix } = read;
      return hasNoHostBits(address, prefix)
        ? { value: { address: address.canonical, prefix } }
        : reject(hostBitsIssue);
    },
  });
}

export { cidr };
export type { CidrBlock, CidrOptions };
