- Allow a repeated declaration of one thing, which resolves instead of failing:
  - An option alias that repeats the option's name, another of its aliases, or a spelling the option already accepts adds nothing, and an `env` list that names one variable twice binds it once.
  - A Command alias that repeats its own name or another of its aliases adds nothing.
  - A signal claimed twice is claimed once.
  - A second value of one extension in one layer replaces the first whole, as a value in a later layer does.
  - A second override of one key in one contributor loses to the first, as overrides across contributors do.

  This removes `@loomcli/core/repeated-alias`, `@loomcli/core/signal-claimed-twice`, `@loomcli/core/extension-value-twice`, and `@loomcli/core/override-twice`. Two different declarations that collide, such as two options with one spelling or two plugins with one identity, stay declaration faults.
