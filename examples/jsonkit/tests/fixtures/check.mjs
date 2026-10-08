// Prints the message of every fault check() returns for jsonkit's declarations, read from the
// Module the first argument names: the bundle's application chunk, or the source under Bun.
const { jsonkit } = await import(
  process.argv[2] === 'source' ? '../../src/application.ts' : '../../dist/application.js'
);

process.stdout.write(`${JSON.stringify(jsonkit.check().map((fault) => fault.message))}\n`);
