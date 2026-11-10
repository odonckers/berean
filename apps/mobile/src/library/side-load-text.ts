// Words and checks for opening a .jwpub from the device (side-load.ts). No
// React Native imports, so node --test can run it.

/** The CoreError tags a side-load can fail with, as the core names them. */
export type SideLoadErrorTag =
  | 'NotFound'
  | 'Corrupt'
  | 'Io'
  | 'StorageFull'
  | 'Cancelled'
  | 'Migration'
  | 'Invalid';

/**
 * How the file is named to the user: its own name in quotes, or "this file"
 * ("This file" to start a sentence).
 */
export function fileLabel(name: string | undefined, startsSentence = false): string {
  const trimmed = name?.trim();
  if (trimmed) {
    return `“${trimmed}”`;
  }
  return startsSentence ? 'This file' : 'this file';
}

/**
 * The message for a failed import, by the core's error tag. `detail` is the
 * core's own text, shown only where it says more than these words would.
 */
export function sideLoadFailure(
  tag: SideLoadErrorTag | undefined,
  name: string | undefined,
  detail: string,
): string {
  const file = fileLabel(name);
  switch (tag) {
    case 'Corrupt':
      return `${fileLabel(name, true)} isn’t a publication Berean can open. It may be damaged, or not a .jwpub file.`;
    case 'StorageFull':
      return `There isn’t enough space on this device to add ${file}. Free up some space and try again.`;
    case 'Io':
    case 'NotFound':
      return `Berean couldn’t read ${file}. Try opening it again.`;
    case undefined:
      return detail;
    default:
      return `Couldn’t add ${file}: ${detail}`;
  }
}

/** Whether a URL handed to the app is a file to open, not a berean:// link. */
export function isFileUrl(url: string): boolean {
  return /^(file|content):\/\//i.test(url);
}

/**
 * The file name at the end of a file URL, when it has one: the last path
 * segment, decoded. A content:// URL usually names a document id, not a
 * file, so only a segment with an extension counts.
 */
export function fileNameFromUrl(url: string): string | undefined {
  const path = url.split(/[?#]/)[0];
  const last = path.slice(path.lastIndexOf('/') + 1);
  let name: string;
  try {
    name = decodeURIComponent(last);
  } catch {
    name = last;
  }
  // Android document ids look like "primary:Download/x.jwpub".
  name = name.slice(name.lastIndexOf('/') + 1);
  name = name.slice(name.lastIndexOf(':') + 1);
  return /\.[A-Za-z0-9]{1,8}$/.test(name) ? name : undefined;
}
