import { Command } from '@loomcli/core';
import type { View } from '@loomcli/core';
import { box } from '@loomcli/plugins/box';
import { heading } from '@loomcli/plugins/heading';
import { list } from '@loomcli/plugins/list';
import { prose } from '@loomcli/plugins/prose';
import { rule } from '@loomcli/plugins/rule';
import { table } from '@loomcli/plugins/table';

interface Service {
  name: string;
  parts?: readonly Service[];
}

interface Pool {
  pool: string;
  instances: number;
  status: string;
}

interface Summary {
  passed: number;
}

// Inside a views record the item type flows into the list's callbacks.
const services = new Command('services').rows<Service>({
  views: {
    list: list({
      children: (service) => service.parts,
      format: (service, index) => `${String(index)} ${service.name}`,
    }),
  },
});

// Every list key is optional, so a list over strings needs no configuration.
const names: View<readonly string[]> = list();

// Hoisted, the factory states its item type.
const hoisted = list<Service>({ format: (service) => service.name, ordered: true });

// The text views are views over a string, so a result over a string names them.
const report = new Command('report').result<string>({
  views: { box: box(), heading: heading({ level: 2 }), prose: prose(), rule: rule() },
});

const titled: View<string> = box({ title: 'Totals' });
const framed: View<string> = box({ content: prose(), title: 'Notes' });

// A box over a table takes the rows' type from the record and passes it to the table.
const pools = new Command('pools').rows<Pool>({
  views: { boxed: box({ content: table(), title: 'Pools' }), table: table() },
});

// Hoisted, the content's factory states its type, and the box infers its own from the content.
const boxedPools: View<readonly Pool[]> = box({ content: table<Pool>() });

// As the second argument of out.render over an array, the item type flows into the list.
const rendered = new Command('rendered').action(async ({ out }) => {
  const parts: readonly Service[] = [{ name: 'api' }];
  await out.render(parts, list({ format: (service) => service.name }));
  // @ts-expect-error TS2339: A callback reads only members the item carries.
  await out.render(parts, list({ format: (service) => service.missing }));
});

new Command('list-format').rows<Service>({
  views: {
    // @ts-expect-error TS2375: A list format receives the item type.
    list: list({ format: (service: number) => String(service) }),
  },
});

new Command('list-children').rows<Service>({
  views: {
    list: list({
      // @ts-expect-error TS2322: Children are items of the same type.
      children: (service) => [service.name],
    }),
  },
});

// @ts-expect-error TS2322: A heading has two levels.
heading({ level: 3 });

new Command('box-bare').result<Summary>({
  // @ts-expect-error TS2554: A box over data that is not a string requires its configuration.
  views: { box: box() },
});

new Command('box-titled').result<Summary>({
  // @ts-expect-error TS2345: A box over data that is not a string requires its content.
  views: { box: box({ title: 'Summary' }) },
});

new Command('boxed-column').rows<Pool>({
  // @ts-expect-error TS2322: A boxed table's column must name a key the row carries.
  views: { boxed: box({ content: table({ columns: ['nope'] }) }) },
});

void services;
void names;
void hoisted;
void report;
void titled;
void framed;
void pools;
void boxedPools;
void rendered;
