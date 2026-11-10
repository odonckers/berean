// Links the system hands the app. A berean:// link routes as usual. A file
// (file:// on iOS, from Open in Berean; content:// or file:// on Android,
// from Open with) is a .jwpub to import: the import starts here and the
// Library, which lists it, opens; once it is in, the publication opens.
import { importFile } from '@/library/side-load';
import { isFileUrl } from '@/library/side-load-text';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (isFileUrl(path)) {
    // importFile reports its own failures on the Library; never let a file
    // crash the app.
    importFile(path).catch(() => {});
    return '/library';
  }
  return path;
}
