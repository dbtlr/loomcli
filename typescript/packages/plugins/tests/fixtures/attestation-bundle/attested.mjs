// An application that sets self-update's attestation through the subpath.
import { Application } from '@loomcli/core';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { attestation } from '@loomcli/plugins/self-update/attestation';

await new Application('notes', {
  plugins: [
    selfUpdate({ attestation: attestation({ workflow: '.github/workflows/release.yml' }) }),
  ],
}).run();
