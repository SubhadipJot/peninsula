export const SEP = "__";
export const META_PREFIX = "store__";

/** Gateway tool/prompt name separator: `<server>__<upstream name>`. */
export function qualify(server: string, name: string): string {
  return `${server}${SEP}${name}`;
}

/**
 * Splits a gateway tool/prompt name into [server, upstreamName] using known
 * server names (longest-prefix safe regardless of upstream naming).
 */
export function dequalify(serverNames: Iterable<string>, name: string): [string, string] | null {
  for (const server of serverNames) {
    const prefix = `${server}${SEP}`;
    if (name.startsWith(prefix)) return [server, name.slice(prefix.length)];
  }
  return null;
}

/** Resource URIs are namespaced by prefixing the scheme: `github+file:///x`. */
export function qualifyUri(server: string, uri: string): string {
  return `${server}+${uri}`;
}

export function dequalifyUri(serverNames: Iterable<string>, uri: string): [string, string] | null {
  for (const server of serverNames) {
    const prefix = `${server}+`;
    if (uri.startsWith(prefix)) return [server, uri.slice(prefix.length)];
  }
  return null;
}
