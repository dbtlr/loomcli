- Add `mcp --http <address>`, which serves an application's MCP tools over the protocol's streamable HTTP transport at `http://<host>:<port>/mcp` instead of stdin and stdout. A port alone listens on 127.0.0.1, port 0 takes any free port, and the run writes the endpoint as its one stdout line. See the [MCP plugin reference](docs/plugins/mcp.md#serving-over-http).
  - A request that carries an `Origin` header is refused with 403, a POST body has a size limit, and each `2026-07-28` request is served on its own while an initialize-era client gets a session that ends on DELETE or when idle. A call answers as an event stream with its progress, and the run's signal aborts every call and tears down each open subscription.
  - A non-loopback address always writes a warning before the endpoint line: about open access without an `authorize` hook, and about unencrypted credentials with one.
- Add optional settings to `mcp()` for the HTTP server alone: `authorize`, which judges each request from a copy of its headers, `maxBodyBytes`, 4 MiB by default, and `sessionIdleMs`, 30 minutes by default. A hook that throws answers 500, and the run reports its first throw once when the server stops, as the Developer Diagnostic `@loomcli/plugins/mcp/broken-authorize-hook` in a development build.
- Change the stdio server so the run's signal ends each open subscription with `notifications/cancelled` and its closing result, as the end of stdin already did, because the protocol requires that teardown of a server on any transport.

### Migration

**Affected surface.** No compile error: graph construction fails at run time. Applications that install `mcp()` and declare a global option named `http`, including one supplied by another plugin, or a global option that claims the spelling `--http` through `aliases` or `visibleAliases`, collide with the MCP Command's new local option.

**Why.** The `mcp` Command now declares `--http`, and core rejects a local option that shares a global option's name or spelling.

**Before and after.**

Before:

```ts
app.globalOption('http', { type: 'string' });
// The action reads options.http.
```

After:

```ts
app.globalOption('endpoint', { type: 'string' });
// The action reads options.endpoint.
```

**Steps.**

1. Find the application's global option named `http`, including plugin options, and any global option whose `aliases` or `visibleAliases` include `http`.
2. Rename an option named `http` and update its readers from `options.http` to the new name. For an alias, remove or rename the alias; the option and its readers stay as they are.
3. Update scripts and documentation that pass the application's old spelling.

**Validation.** Run the application's `--help` and `mcp --help` commands to verify that the graph builds and the renamed option appears. Run the application's test command.
