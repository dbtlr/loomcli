/** One line of `sha256sum` output: the digest, a space and a space or `*`, and the file name. */
const sumLine = /^(?<digest>[\da-f]{64}) [ *](?<file>.+)$/u;

/** What `SHA256SUMS` says about one asset: its digest, or that it lists none or two that differ. */
type Listing =
  | { readonly digest: string }
  | { readonly missing: true }
  | { readonly conflict: true };

/** The asset's digest from `SHA256SUMS`, matching its file name exactly and ignoring other lines. */
function listingOf(sums: string, asset: string): Listing {
  const digests = new Set<string>();
  for (const line of sums.split('\n')) {
    const groups = sumLine.exec(line.replace(/\r$/u, ''))?.groups;
    if (groups?.file === asset && groups.digest !== undefined) {
      digests.add(groups.digest);
    }
  }
  const [digest, other] = digests;
  if (digest === undefined) {
    return { missing: true };
  }
  return other === undefined ? { digest } : { conflict: true };
}

export type { Listing };
export { listingOf };
