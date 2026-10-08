---
'@modelcontextprotocol/core-internal': minor
'@modelcontextprotocol/client': minor
'@modelcontextprotocol/server': minor
---

Server and client extensions (experimental: the `extensions` option, the extension shapes, `use` and `acceptResultType` may change in a minor release). `ServerOptions.extensions` and `McpServerOptions.extensions` take `ServerExtension` objects, `{ id, install?(server), attach?(mcp) }`. `install` receives the low-level `Server` and registers custom methods, middleware and capability settings. `attach` receives the `McpServer` and registers resources and tools, so the Skills extension can be passed as `extensions: [skills]`. Each extension is advertised under `capabilities.extensions[id]`; every `install` runs in order, then every `attach`. The low-level `Server` runs only `install` and refuses an extension with `attach`. A duplicate id, or an extension with neither hook, fails construction before anything is installed.

`Protocol.use(method, (request, ctx, next) => …)` is middleware around the registered handler, composed at dispatch time in registration order, so middleware on `tools/call` applies even though `McpServer` registers that handler lazily; it returns a remover. `ClientOptions.extensions` takes `ClientExtension` objects (`{ id, install(client) }`), advertised under the client's `capabilities.extensions[id]` (in `initialize` on a legacy connection, in every request's client-capabilities envelope on 2026-07-28) and installed with the `Client`; duplicate ids fail construction. `Protocol.acceptResultType(method, resultType)` declares an extension result kind for a method: a raw response carrying that `resultType` bypasses the era codec's closed vocabulary and is validated against the caller's explicit result schema as-is, which is how a client extension receives shapes such as the Tasks extension's `resultType: "task"` on `tools/call`.

`McpServer` tool dispatch now re-throws `MissingRequiredClientCapabilityError` (`-32021`) as a JSON-RPC error instead of converting it into an `isError` tool result, matching the existing `UrlElicitationRequiredError` passthrough.
