import { Application, DeclarationError, diagnosticRule, InternalError } from '@loomcli/core';
import type { DiagnosticParts, DiagnosticRule, Finding, Host, ReleaseFacts } from '@loomcli/core';

// An action reads its run's release facts from its host, and narrows on the build.
const about = new Application('app', { description: 'Print how this copy was built.' }).action(
  ({ host, out }) => {
    const { build, installation, release }: ReleaseFacts = host.release;
    const development: boolean = build === 'source' || build === 'development';
    const lane: string | undefined = release?.lane;
    const asset: string | undefined = release?.asset;
    const digest: string | undefined = installation?.digest;
    return out.print(`${String(development)} ${lane ?? ''} ${asset ?? ''} ${digest ?? ''}`);
  },
);

// A test supplies the facts through the host override, of run() and app.invoke alike.
const supplied: ReleaseFacts = {
  build: 'distributed',
  release: { lane: 'next', repository: 'acme/notes', version: '1.1.0-next.3' },
};
void about.run({ host: { release: supplied } });
void about.invoke([], {}, { host: { release: supplied } });

// @ts-expect-error TS2322: a build is source, development, or distributed.
const staging: ReleaseFacts = { build: 'staging' };

// @ts-expect-error TS2353: the Application reads no packet; the build bakes the release facts.
new Application('app', { packet: { build: 'development' } });

// Check returns every declaration fault as a value.
const faults: readonly DeclarationError[] = about.check();

const rule: DiagnosticRule = diagnosticRule('@acme/retry/retry-limit', {
  explanation: 'The plugin accepts from 0 through 10 retries.',
  headline: 'Retry limit out of range',
});
const docs: string | undefined = rule.docs;

const finding: Finding = { arguments: [50], call: 'retry', mark: '0', note: 'from 0 through 10' };
const parts: DiagnosticParts = {
  correction: ['Pass a whole number from 0 through 10.', 'Omit the limit.'],
  findings: [finding],
  sentence: 'retry() received 50 retries.',
};

// The structured constructor stands beside the sentence-only one, and both take ErrorOptions.
const structured = new DeclarationError(rule, parts, { cause: new Error('why') });
const plain = new DeclarationError('A sentence.', { cause: 'why' });
const fields: [
  DiagnosticRule | undefined,
  string,
  readonly Finding[],
  string | readonly string[] | undefined,
] = [structured.rule, plain.sentence, plain.findings, structured.correction];

// @ts-expect-error TS2769: a structured fault states its sentence.
new DeclarationError(rule, { correction: 'Fix it.' });

const defect = new InternalError(rule, { cause: new TypeError('Boom.'), sentence: 'It broke.' });
const legacy = new InternalError('It broke.', undefined);
const defectFields: [unknown, string, string | readonly string[] | undefined] = [
  defect.cause,
  legacy.sentence,
  defect.correction,
];

// @ts-expect-error TS2769: a structured defect carries its cause, even an undefined one.
new InternalError(rule, { sentence: 'It broke.' });

// A host override may supply its own source reader, or leave process capture's in place.
const reader: Host['readSource'] = (path, cwd) => (path.startsWith(cwd) ? '' : undefined);
const host: Partial<Host> = { readSource: reader };

// @ts-expect-error TS2322: a source reader answers a string or undefined.
const wrongReader: Host['readSource'] = () => 1;

export { defectFields, docs, faults, fields, host, staging, wrongReader };
