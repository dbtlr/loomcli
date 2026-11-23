/**
 * How the running application was built, released, and installed. The build bakes the build and
 * release facts into the artifact, core reads the installation from the matching record or the application's path,
 * and core fills `host.release` from them for every run; a run of the source, with nothing baked in,
 * reads `{ build: 'source' }`.
 *
 * @public
 */
export interface ReleaseFacts {
  /** `source` and `development` are development builds, and `distributed` is a distributed one. */
  readonly build: 'source' | 'development' | 'distributed';
  /** Present only when the artifact was built as a release. */
  readonly release?: {
    readonly version: string;
    /** The first prerelease identifier of `version`, or `stable` when it has none. */
    readonly channel: string;
    /** The repository the release belongs to, as `owner/name`. */
    readonly repository: string;
    /** The release asset's name, present for a compiled binary alone. */
    readonly asset?: string;
    /** The full package name from the release manifest, including its scope. */
    readonly npmPackage?: string;
  };
  /**
   * How the release was installed, from a matching installation record or the running
   * application's resolved path.
   */
  readonly installation?: {
    /** The recorded method, or `brew`, `npm`, `pnpm`, `bun`, or `yarn` from the resolved path. The script records `script`. */
    readonly method: string;
    readonly path: string;
    /** The digest from a matching installation record. */
    readonly digest?: string;
    /** The formula name when the resolved path identifies a Homebrew installation. */
    readonly formula?: string;
  };
}
