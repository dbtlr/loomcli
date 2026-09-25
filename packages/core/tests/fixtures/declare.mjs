import { DeclarationError } from '@loomcli/core';

/**
 * Evaluates one declaration and reports the declaration fault it throws, so a test reads the fault
 * from the call that raised it rather than from a build. A declaration that throws ends the fixture
 * here, so nothing after it runs.
 */
export function declare(build) {
  try {
    return build();
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    process.stdout.write(`thrown:${error.exitCode}: ${error.message}\n`);
    process.exit(0);
  }
}
