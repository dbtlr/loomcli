import { escapeControlCharacters } from '@loomcli/core';

// Each argument arrives as JSON, so a test can pass any code point through the process boundary.
const texts = JSON.parse(process.argv[2]);
process.stdout.write(JSON.stringify(texts.map((text) => escapeControlCharacters(text))));
