export interface SurfacePackage {
  readonly directory: string;
  readonly modules: readonly string[];
  /**
   * While a package is being tagged, the exports-map entries whose API reports, tags, and lists
   * are checked so far; omitted, every entry. The declaration-import scan reads the whole package.
   */
  readonly coveredEntries?: readonly string[];
  readonly entries: Readonly<
    Record<
      string,
      {
        readonly forgottenExports?: Readonly<Record<string, string>>;
        readonly externalExports?: Readonly<Record<string, string>>;
      }
    >
  >;
}
export function checkApi(
  root: string,
  packages: readonly SurfacePackage[],
  options?: { update?: boolean },
): string[];
