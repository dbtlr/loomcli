// An application that installs self-update without importing the attestation subpath.
import { Application } from '@loomcli/core';
import { selfUpdate } from '@loomcli/plugins/self-update';

await new Application('notes', { plugins: [selfUpdate()] }).run();
