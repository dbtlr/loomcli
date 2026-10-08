// Prints the message of every fault check() returns for textstat's declarations, read from the
// Module the first argument names: the bundle's application chunk, or the source under Bun.
const { textstat } = await import(
  process.argv[2] === 'source' ? '../../src/application.ts' : '../../dist/application.js'
);

process.stdout.write(`${JSON.stringify(textstat.check().map((fault) => fault.message))}\n`);
