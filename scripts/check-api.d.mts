export interface SurfacePackage {
  readonly directory: string;
  readonly modules: readonly string[];
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
