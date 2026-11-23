import { DeclarationError } from '@loomcli/core';

import { packageName } from '../constants.js';
import { attestationWorkflowRule } from '../rules.js';
import { settingOf } from './attestation-setting.js';
import type { AttestationCheck, AttestationSetting } from './attestation-setting.js';

const identity = `${packageName}/self-update`;

/** A workflow file's path in `.github/workflows`: a file name with no `/` that ends in `.yml` or `.yaml`. */
const workflowPath = /^\.github\/workflows\/[^/]+\.ya?ml$/u;

/**
 * What `attestation()` takes.
 *
 * @public
 */
interface AttestationSettings {
  /**
   * The path of the workflow that runs the attestation job, in the application's repository, such
   * as `.github/workflows/release.yml`.
   */
  readonly workflow: string;
}

/**
 * Verifies an attestation with the sigstore-js packages, which load only when an update reaches
 * this step, so a run that never verifies does not read them.
 */
async function attest(workflow: string, check: AttestationCheck): Promise<void> {
  const { verifyAttestation } = await import('./attestation/verify.js');
  await verifyAttestation(workflow, check);
}

/**
 * The value `selfUpdate()` takes as `attestation`, which makes self-update verify a GitHub artifact
 * attestation of the release asset, signed by the pinned workflow on the release's tag, before it
 * downloads the asset. It throws a `DeclarationError` at the call for a `workflow` that is not a
 * workflow file's path in `.github/workflows`.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { selfUpdate } from '@loomcli/plugins/self-update';
 * import { attestation } from '@loomcli/plugins/self-update/attestation';
 *
 * export const app = new Application('notes', {
 *   plugins: [selfUpdate({ attestation: attestation({ workflow: '.github/workflows/release.yml' }) })],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/self-update.md#attestation
 *
 * @public
 */
function attestation(settings: AttestationSettings): AttestationSetting {
  const { workflow } = settings;
  if (!workflowPath.test(workflow)) {
    throw new DeclarationError(attestationWorkflowRule, {
      correction:
        'Name the workflow file that runs the attestation job, such as .github/workflows/release.yml.',
      findings: [{ arguments: [settings], call: 'attestation', mark: '0.workflow' }],
      sentence: `Plugin "${identity}" setting "attestation.workflow" is not a workflow file in .github/workflows.`,
    });
  }
  return settingOf(workflow, (check) => attest(workflow, check));
}

export type { AttestationSettings };
export { attestation };

// The plugin pack's member of MessagePackages, which this entry's declarations load.
export type {} from '../registry.js';
