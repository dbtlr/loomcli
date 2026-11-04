/**
 * How the running application was built, released, and installed. The build bakes the build and
 * release facts into the artifact, core reads the installation from the installation record, and
 * core fills `host.release` from them for every run; a run of the source, with nothing baked in,
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
  };
  /**
   * How the application was installed, read from the installation record's `install.json` for a
   * compiled binary built as a release, and present only when its path is the running executable.
   */
  readonly installation?: {
    readonly method: string;
    readonly path: string;
    readonly digest: string;
  };
}
