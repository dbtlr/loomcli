import { invalid } from './link.js';

/** Settings are checked before resolving a skipped question, so every call has the same contract. */
export function checkSettings(
  settings: unknown,
  kind: 'text' | 'secret' | 'confirm' | 'select',
): void {
  if (typeof settings !== 'object' || settings === null || !('message' in settings)) {
    invalid(
      'A question has no settings object or message.',
      'Supply settings with a one-line message.',
    );
  }
  if ('option' in settings && typeof settings.option !== 'string') {
    invalid('A question option is not a string.', 'Name a local option.');
  }
  if ('default' in settings) {
    if (kind === 'secret') {
      invalid('A secret question declares a default.', 'Remove default.');
    }
    const type = kind === 'confirm' ? 'boolean' : 'string';
    if (typeof settings.default !== type) {
      invalid(
        `A ${kind} question declares a default that is not ${type}.`,
        `Supply a ${type} default or omit it.`,
      );
    }
  }
  if ('validate' in settings && settings.validate !== undefined) {
    const schema = settings.validate;
    if (kind !== 'text' && kind !== 'secret') {
      invalid(`A ${kind} question declares validate.`, 'Remove validate.');
    }
    if (
      (typeof schema !== 'object' && typeof schema !== 'function') ||
      schema === null ||
      !('~standard' in schema)
    ) {
      invalid(
        'A question validate is not a Standard Schema v1 value.',
        'Supply a Standard Schema v1 validator.',
      );
    }
    const standard = schema['~standard'];
    if (
      typeof standard !== 'object' ||
      standard === null ||
      !('version' in standard) ||
      standard.version !== 1 ||
      !('vendor' in standard) ||
      typeof standard.vendor !== 'string' ||
      !('validate' in standard) ||
      typeof standard.validate !== 'function'
    ) {
      invalid(
        'A question validate is not a Standard Schema v1 value.',
        'Supply a Standard Schema v1 validator.',
      );
    }
  }
  if (kind === 'select') {
    if (
      !('choices' in settings) ||
      !Array.isArray(settings.choices) ||
      settings.choices.length === 0 ||
      settings.choices.some((choice: unknown) => typeof choice !== 'string') ||
      new Set(settings.choices).size !== settings.choices.length
    ) {
      invalid(
        'A select question has invalid choices.',
        'Supply a nonempty list of distinct strings.',
      );
    }
    if ('default' in settings && !settings.choices.includes(settings.default)) {
      invalid(
        'A select question default is not a choice.',
        'Use a declared choice or omit default.',
      );
    }
  }
}
