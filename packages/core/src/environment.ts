import type { Plugin } from './plugin.js';

/** The shallow type information an Application supplies before its Command graph is composed. */
interface ApplicationEnvironment<Globals = {}, Plugins extends readonly Plugin[] = readonly []> {
  readonly globals: Globals;
  readonly plugins: Plugins;
}

interface RegistrationShape {
  environment?: ApplicationEnvironment<unknown, readonly Plugin[]>;
}

/** The Application augments this interface once in its own TypeScript compilation context. */
// Module augmentation requires an interface; a type alias cannot be augmented.
// oxlint-disable-next-line typescript/no-empty-interface
interface Register extends RegistrationShape {}

type RegisteredEnvironment = Register extends { environment: infer Environment }
  ? Environment extends ApplicationEnvironment<unknown, readonly Plugin[]>
    ? Environment
    : never
  : ApplicationEnvironment;

type RegisteredGlobals = RegisteredEnvironment['globals'];

/** A private type marker avoids pretending parsed global values exist before an invocation. */
declare const applicationEnvironment: unique symbol;

type EnvironmentOf<
  Value extends {
    readonly [applicationEnvironment]: ApplicationEnvironment<unknown, readonly Plugin[]>;
  },
> = Value[typeof applicationEnvironment];

export type {
  ApplicationEnvironment,
  EnvironmentOf,
  Register,
  RegisteredEnvironment,
  RegisteredGlobals,
  applicationEnvironment,
};
