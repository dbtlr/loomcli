export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalError';
  }
}

export class DeclarationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeclarationError';
  }
}
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

export function describeFailure(error: unknown): {
  code: 1 | 2;
  kind: 'declaration' | 'input' | 'fatal' | 'internal';
  message: string;
} {
  if (error instanceof DeclarationError) {
    return { code: 1, kind: 'declaration', message: `Invalid declaration: ${error.message}` };
  }
  if (error instanceof InputError) {
    return { code: 2, kind: 'input', message: `Invalid input: ${error.message}` };
  }
  if (error instanceof FatalError) {
    return { code: 1, kind: 'fatal', message: error.message };
  }
  return {
    code: 1,
    kind: 'internal',
    message: `Internal error: ${error instanceof Error ? error.message : 'An unknown error occurred.'}`,
  };
}
