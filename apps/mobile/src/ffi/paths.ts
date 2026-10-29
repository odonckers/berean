/**
 * The core takes plain filesystem paths; expo-file-system hands out
 * `file://` URIs. `file:///data/user/0/…/files/` → `/data/user/0/…/files`.
 */
export function fileUriToPath(uri: string): string {
  const scheme = 'file://';
  if (!uri.startsWith(scheme)) {
    throw new Error(`Not a file:// URI: ${uri}`);
  }
  const path = decodeURIComponent(uri.slice(scheme.length));
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
