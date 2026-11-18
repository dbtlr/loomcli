/*
 * The value of `mcp --http`: a port, or `host:port` with an IPv6 host in brackets. It is read on
 * every run that names the option, so it imports no network module.
 */
import { createValidator } from '@loomcli/validators';

import { httpAddressIssue } from './messages.js';

/** Where the HTTP server listens, and the address as the operator wrote it. */
interface HttpAddress {
  /** The host to bind, without brackets: 127.0.0.1 for a port alone. */
  readonly host: string;
  readonly port: number;
  /** The host as the URL line writes it, an IPv6 host in brackets. */
  readonly urlHost: string;
  readonly written: string;
}

/** The host a port alone binds, as the protocol advises for a server that runs locally. */
const defaultHost = '127.0.0.1';
/** The highest port number. */
const highestPort = 65_535;

/** The form of the value: an optional host, bracketed for IPv6, then a decimal port. */
const addressForm = /^(?:(?:\[(?<ipv6>[^\]]*)\]|(?<name>[\w.-]+)):)?(?<port>\d{1,5})$/u;

/** Whether a bracketed host holds an IPv6 address, as a URL reads one. */
function isIpv6Literal(bracketed: string): boolean {
  try {
    return new URL(`http://${bracketed}/`).hostname.includes(':');
  } catch {
    return false;
  }
}

/** The address a value names, or nothing when the option does not accept it. */
function addressOf(written: string): HttpAddress | undefined {
  const groups = /[\t\r\n]/u.test(written) ? undefined : addressForm.exec(written)?.groups;
  const port = Number(groups?.port);
  if (groups === undefined || port > highestPort) {
    return undefined;
  }
  const { ipv6, name = defaultHost } = groups;
  if (ipv6 === undefined) {
    return { host: name, port, urlHost: name, written };
  }
  const urlHost = `[${ipv6}]`;
  return isIpv6Literal(urlHost) ? { host: ipv6, port, urlHost, written } : undefined;
}

/** The `--http` value, read as the address it names, or the sentence that names the accepted forms. */
const httpAddress = createValidator({
  inputSchema: { type: 'string' },
  parse: (raw: string) => {
    const address = addressOf(raw);
    return address === undefined ? { issues: [{ message: httpAddressIssue }] } : { value: address };
  },
});

export { addressOf, httpAddress };
export type { HttpAddress };
