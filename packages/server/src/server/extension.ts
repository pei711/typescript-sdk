import type { McpServer } from './mcp';
import type { Server } from './server';

/**
 * A server extension: a unit of protocol behaviour outside the core
 * specification (an MCP extension such as `io.modelcontextprotocol/tasks`
 * or `io.modelcontextprotocol/skills`, or a vendor feature), passed to the
 * server at construction.
 *
 * ```ts
 * const server = new McpServer(info, { extensions: [skills, tasks] });
 * ```
 *
 * An extension hooks in at one or both of two levels:
 *
 * - `install(server)` receives the low-level {@linkcode Server}. This is the
 *   protocol level: custom methods (`server.setRequestHandler`), middleware
 *   on spec methods (`server.use('tools/call', …)`), notification handlers,
 *   and capability settings (`server.registerCapabilities`). It runs on both
 *   `Server` and `McpServer`.
 * - `attach(mcp)` receives the {@linkcode McpServer}. This is the feature
 *   level: resources, resource templates and tools registered through the
 *   high-level API (`mcp.registerResource`, `mcp.registerTool`). It runs only
 *   through `McpServer`, which is why the low-level `Server` refuses an
 *   extension that has it.
 *
 * The server advertises each extension under `capabilities.extensions[id]`
 * as `{}`, runs every `install` in array order, then every `attach` in array
 * order. Settings an extension registers itself replace the `{}`. A duplicate
 * `id`, or an extension with neither hook, fails construction before any
 * extension is installed. The SDK provides the hooks; what an extension does
 * behind them, such as how it stores state or where its work runs, is the
 * extension's own.
 *
 * Experimental: the shape of an extension may change in a minor release.
 *
 * @experimental
 */
export interface ServerExtension {
    /**
     * The extension identifier, prefix-qualified (`io.modelcontextprotocol/tasks`,
     * `com.example/feature-flags`). Advertised as the key under
     * `capabilities.extensions`, and unique per server.
     */
    readonly id: string;
    /** Installs protocol-level behaviour onto the low-level server: methods, middleware, capability settings. Called once, at construction. */
    install?(server: Server): void;
    /** Registers features through the high-level server: resources, templates, tools. Called once, at construction, after every `install`. */
    attach?(mcp: McpServer): void;
}

/**
 * Checks and installs `extensions` on `server`, and attaches them to `mcp`
 * when the server is an `McpServer`'s. Every check runs before anything is
 * installed, so a rejected list leaves the server untouched. A hook that
 * throws fails the constructor that called this, so a server with a partly
 * installed extension never exists.
 *
 * Package-internal: called by the `Server` and `McpServer` constructors.
 */
export function installServerExtensions(server: Server, extensions: readonly ServerExtension[], mcp: McpServer | undefined): void {
    const ids = new Set<string>();
    for (const extension of extensions) {
        if (ids.has(extension.id)) {
            throw new Error(`Extension "${extension.id}" is listed more than once; pass each extension once`);
        }
        ids.add(extension.id);
        if (extension.install === undefined && extension.attach === undefined) {
            throw new TypeError(`Extension "${extension.id}" has neither install nor attach`);
        }
        if (extension.attach !== undefined && mcp === undefined) {
            throw new Error(
                `Extension "${extension.id}" attaches to an McpServer; pass it to new McpServer(info, { extensions }) instead of the low-level Server`
            );
        }
    }
    for (const extension of extensions) {
        server.registerCapabilities({ extensions: { [extension.id]: {} } });
        extension.install?.(server);
    }
    if (mcp === undefined) return;
    for (const extension of extensions) extension.attach?.(mcp);
}
