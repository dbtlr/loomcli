/**
 * The RFC 3986 `URI` production, built from the RFC's own rule names:
 * `scheme ":" hier-part [ "?" query ] [ "#" fragment ]`.
 * Letters are spelled in both cases, so the expression needs no `i` flag.
 */

const hex = '[0-9A-Fa-f]';
const pctEncoded = `%${hex}{2}`;
const unreserved = String.raw`A-Za-z0-9\-._~`;
const subDelims = "!$&'()*+,;=";
const pchar = `(?:[${unreserved}${subDelims}:@]|${pctEncoded})`;

const scheme = String.raw`[A-Za-z][A-Za-z0-9+\-.]*`;
const userinfo = `(?:[${unreserved}${subDelims}:]|${pctEncoded})*`;

const decOctet = '(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])';
const ipv4 = String.raw`${decOctet}(?:\.${decOctet}){3}`;
const h16 = `${hex}{1,4}`;
const ls32 = `(?:${h16}:${h16}|${ipv4})`;
const ipv6 = `(?:${[
  `(?:${h16}:){6}${ls32}`,
  `::(?:${h16}:){5}${ls32}`,
  `(?:${h16})?::(?:${h16}:){4}${ls32}`,
  `(?:(?:${h16}:){0,1}${h16})?::(?:${h16}:){3}${ls32}`,
  `(?:(?:${h16}:){0,2}${h16})?::(?:${h16}:){2}${ls32}`,
  `(?:(?:${h16}:){0,3}${h16})?::${h16}:${ls32}`,
  `(?:(?:${h16}:){0,4}${h16})?::${ls32}`,
  `(?:(?:${h16}:){0,5}${h16})?::${h16}`,
  `(?:(?:${h16}:){0,6}${h16})?::`,
].join('|')})`;
const ipvFuture = String.raw`[vV]${hex}+\.[${unreserved}${subDelims}:]+`;
const ipLiteral = String.raw`\[(?:${ipv6}|${ipvFuture})\]`;
const regName = `(?:[${unreserved}${subDelims}]|${pctEncoded})*`;
const host = `(?:${ipLiteral}|${ipv4}|${regName})`;
const authority = `(?:${userinfo}@)?${host}(?::[0-9]*)?`;

const pathAbempty = `(?:/${pchar}*)*`;
const pathAbsolute = `/(?:${pchar}+(?:/${pchar}*)*)?`;
const pathRootless = `${pchar}+(?:/${pchar}*)*`;
const hierPart = `(?://${authority}${pathAbempty}|${pathAbsolute}|${pathRootless}|)`;
const queryOrFragment = `(?:${pchar}|[/?])*`;

const uriPattern = new RegExp(
  String.raw`^${scheme}:${hierPart}(?:\?${queryOrFragment})?(?:#${queryOrFragment})?$`,
  'u',
);

/** The RFC 3986 `scheme` production on its own, for checking a declared protocol. */
const schemePattern = new RegExp(`^${scheme}$`, 'u');

export { schemePattern, uriPattern };
