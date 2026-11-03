/**
 * Writes the loom package's dist/licenses and dist/NOTICE from the packages its built files hold,
 * and fails when the package's license field does not name exactly the licenses the bundle needs.
 */
export function writeNotices(repositoryRoot: string): void;
