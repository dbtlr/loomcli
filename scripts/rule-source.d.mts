/** One rule as a registry's source declares it. */
export interface RegisteredRule {
  readonly name: string;
  readonly headline: string | undefined;
  readonly explanation: string | undefined;
}

/** One rule as a package's source declares it, with where it stands. */
export interface DeclaredRule {
  readonly identity: string;
  readonly headline: string;
  readonly explanation: string;
  readonly docs: string | undefined;
  readonly file: string;
  readonly line: number;
}

export function definitionText(definition: string, key: string): string | undefined;
export function registeredRules(file: URL, call: RegExp): RegisteredRule[];
export function rulesInSource(
  source: string,
  file: string,
  packageName: string,
): { readonly problems: string[]; readonly rules: DeclaredRule[] };
export function readDeclaredRules(root: string): DeclaredRule[];
