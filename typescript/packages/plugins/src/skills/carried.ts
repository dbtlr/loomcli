/**
 * The identifier `loom build` replaces with the skills folder it carried, through a bundler
 * `define` of its own beside `__LOOM_RELEASE__`. Nothing declares it at run time, so an unbuilt run
 * or a custom build reads it as absent through `typeof`. The skills plugin alone reads it.
 */
declare const __LOOM_SKILLS__: unknown;

/** What the build carried, as baked, or `undefined` when nothing was baked. */
function carriedSkills(): unknown {
  return typeof __LOOM_SKILLS__ === 'undefined' ? undefined : __LOOM_SKILLS__;
}

/**
 * The address a carried copy's `loom-skills/` folder sits beside: this module's own. A bundle's
 * chunks sit flat in its output directory, so the folder is beside each of them, and in a compiled
 * binary every module's address is the binary's own in Bun's embedded file system, beside which the
 * build embedded the folder.
 */
const carriedBase: string = import.meta.url;

export { carriedBase, carriedSkills };
