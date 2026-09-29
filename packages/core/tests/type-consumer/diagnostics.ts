import { Application, DeclarationError, diagnosticRule, InternalError } from '@loomcli/core';
import type { DiagnosticParts, DiagnosticRule, Finding, Host, Packet } from '@loomcli/core';

// A JSON module types its members as string, which is what Packet.build accepts.
const imported: { build: string } = { build: 'development' };
const packet: Packet = imported;
new Application('app', { packet });

// @ts-expect-error TS2322: a packet's build is a string.
new Application('app', { packet: { build: true } });

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

export { defectFields, docs, fields, host, wrongReader };
