import type { Plugin } from '../plugins/plugin.js';

/**
 * The shallow type information an Application supplies before its Command graph is composed.
 *
 * @public
 * @sealed
 */
interface ApplicationEnvironment<Globals = {}, Plugins extends readonly Plugin[] = readonly []> {
  /** The type of the Application's global option values. */
  readonly globals: Globals;
  /** The Application's installed plugins. */
  readonly plugins: Plugins;
}

interface RegistrationShape {
  /** The Application's environment, once its registration is visible in this compilation. */
  environment?: ApplicationEnvironment<unknown, readonly Plugin[]>;
}

/**
 * The Application augments this interface once in its own TypeScript compilation context.
 *
 * @public
 */
// Module augmentation requires an interface; a type alias cannot be augmented.
// oxlint-disable-next-line typescript/no-empty-interface
interface Register extends RegistrationShape {}

/**
 * The environment of the Application that registered itself in this compilation, or the default
 * environment when none did.
 *
 * @public
 * @sealed
 */
type RegisteredEnvironment = Register extends { environment: infer Environment }
  ? Environment extends ApplicationEnvironment<unknown, readonly Plugin[]>
    ? Environment
    : never
  : ApplicationEnvironment;

type RegisteredGlobals = RegisteredEnvironment['globals'];

/** Whether an Application's registration is visible in this compilation context. */
type RegistrationVisible = Register extends { environment: unknown } ? true : false;

/** A private type marker avoids pretending parsed global values exist before an invocation. */
declare const applicationEnvironment: unique symbol;

/**
 * The environment an Application or a Command's phantom marker carries.
 *
 * @public
 * @sealed
 */
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
  RegistrationVisible,
  applicationEnvironment,
};
