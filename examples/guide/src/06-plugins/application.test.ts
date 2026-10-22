/// <reference types="bun" />
import { test } from 'bun:test';

import { assertAssembles } from '@loomcli/testing';

import { pace } from './application.js';

// Keep this test. It is the check that the whole application assembles, so a fault only the
// assembled application reveals fails CI rather than the operator's first run.
test('the application assembles', () => {
  assertAssembles(pace);
});
