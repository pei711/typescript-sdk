---
shape: how-to
---

# Server extensions

::: warning Experimental
The `extensions` option, the `ServerExtension` and `ClientExtension` shapes, `use` and `acceptResultType` are experimental and may change in a minor release.
:::

A **server extension** packages protocol behaviour outside the core specification, such as the `io.modelcontextprotocol/tasks` or `io.modelcontextprotocol/skills` extension or a vendor feature, as one object you pass to the server. The SDK advertises it and installs it, and gives it hooks at two levels: the protocol, where it adds methods and middleware, and the high-level `McpServer`, where it registers resources and tools. What the extension does behind those hooks is its own business.

## Write an extension

An extension is an `id` plus one or both of two hooks:

- `install(server)` receives the low-level `Server`. Use it for custom methods (`setRequestHandler`), middleware on spec methods (`use`), notification handlers and capability settings (`registerCapabilities`). It runs on both `Server` and `McpServer`.
- `attach(mcp)` receives the `McpServer`. Use it for anything registered through the high-level API, such as `registerResource` with a `ResourceTemplate`, or `registerTool`. It runs only through `McpServer`.

This extension works at the protocol level only:

```ts
import type { ServerExtension } from '@modelcontextprotocol/server';
import { MissingRequiredClientCapabilityError, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const GATE = 'com.example/gate';

export const gate: ServerExtension = {
    id: GATE,
    install(server) {
        // Settings for the advertised capability, if the extension has any.
        server.registerCapabilities({ extensions: { [GATE]: { exampleData: true } } });

        // A custom method, exactly as in Custom methods.
        server.setRequestHandler('gate/status', { params: z.looseObject({}) }, () => ({ armed: true }));

        // Middleware on a spec method: runs around the registered handler,
        // may answer, transform, or refuse.
        server.use('tools/call', (request, ctx, next) => {
            const declared = ctx.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY]?.extensions ?? {};
            if (!(GATE in declared)) {
                throw new MissingRequiredClientCapabilityError({ requiredCapabilities: { extensions: { [GATE]: {} } } }, 'declare the gate');
            }
            return next(request, ctx);
        });
    }
};
```

An extension that serves resources attaches instead. The Skills extension is one: it has an `id` and an `attach(mcp)`, so it is a `ServerExtension` as it stands.

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { loadSkills } from '@modelcontextprotocol/server/ext/skills/node';

const skills = await loadSkills('./skills');
const server = new McpServer({ name: 'skills-server', version: '1.0.0' }, { extensions: [skills] });
```

Passing it in `extensions` is the same as calling `skills.attach(server)` before connecting.

## Install it

Pass extensions at construction:

```ts
const server = new McpServer({ name: 'gated', version: '1.0.0' }, { extensions: [gate, skills] });
```

The server then does three things, in this order:

1. Advertises each extension under `capabilities.extensions[id]` as `{}`. Legacy connections see it in the `initialize` result, and 2026-07-28 connections see it in `server/discover`. Settings an extension registers itself replace the `{}`.
2. Runs every `install`, in array order, after the built-in handlers exist.
3. Runs every `attach`, in array order.

Construction fails before anything is installed if two extensions share an `id`, or if an extension has neither hook. A hook that throws fails the constructor, so a server with a partly installed extension never exists.

The low-level `Server` takes the same `extensions` option and runs only `install`. It refuses an extension that has `attach`, because that extension needs `McpServer`.

## Client extensions

The client half has one level: `ClientExtension` is `{ id, install(client) }`, passed in `ClientOptions.extensions`. The client advertises it under its own `capabilities.extensions[id]`. On a legacy connection that is the `initialize` request, and on a 2026-07-28 connection it is every request's `_meta` client-capabilities envelope, which is where a server extension reads it. `install` receives the `Client` to register handlers for server-to-client requests and notifications, or to wrap the ones the SDK installs with middleware. A duplicate `id` fails construction here too.

```ts
import type { ClientExtension } from '@modelcontextprotocol/client';

const gateClient: ClientExtension = {
    id: GATE,
    install(client) {
        client.setRequestHandler('gate/ping', { params: z.looseObject({}) }, () => ({ pong: true }));
        // Results of tools/call may carry the extension's own kind; the
        // explicit-schema request() path then hands them to the caller's
        // schema as-is instead of rejecting the unknown resultType.
        client.acceptResultType('tools/call', 'gate');
    }
};

const client = new Client({ name: 'gated-client', version: '1.0.0' }, { extensions: [gateClient] });
```

## How middleware composes

`setRequestHandler` is the route handler. `use(method, middleware)` is the middleware around it, in the Koa style: `await next(request, ctx)` yields the result, and the middleware returns what goes on the wire. It wraps whatever handler serves `method` at dispatch time, including a handler another extension registered. That matters for `tools/call`, which `McpServer` registers on the first tool registration: middleware installed at construction still applies. With no underlying handler, `next` throws `MethodNotFound`.

Several middleware nest in registration order, the first installed outermost. The returned function removes the middleware. Method names are exact, and there is no wildcard.

An extension wraps the methods it doesn't own with `use`, and never registers them again. Something every peer must know about the extension belongs in its advertised capability (`registerCapabilities`), not in per-request `_meta`. Where a result does carry extension `_meta`, the middleware adds its own namespaced key, and the encoder still stamps the SDK's reserved keys and `resultType` on top.

A thrown `ProtocolError` becomes the JSON-RPC error response. Inside a tool handler, `McpServer` converts most throws into an `isError` tool result. The exceptions are the protocol-level errors the client must see as errors: `UrlElicitationRequiredError` and `MissingRequiredClientCapabilityError` (`-32021`).

## Recap

- `ServerExtension` is `{ id, install?(server), attach?(mcp) }`, passed in `extensions`. `install` gets the low-level `Server` and `attach` gets the `McpServer`.
- Every `install` runs before every `attach`, each in array order. Only `McpServer` runs `attach`.
- Duplicate ids, and extensions with no hook, fail construction before anything is installed.
- `ClientExtension` is `{ id, install(client) }` on `ClientOptions.extensions`.
- Middleware composes at dispatch time, in registration order, and applies to handlers registered later, including other extensions' handlers.
- `acceptResultType(method, resultType)` lets a client extension receive a result kind outside `complete` / `input_required` through the explicit-schema `request()` path.
- The SDK owns the hooks and the capability advertisement, not the extension's state or execution.
