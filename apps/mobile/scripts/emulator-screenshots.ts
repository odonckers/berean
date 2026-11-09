// Captures the key screens on a running Android emulator, for the
// screenshots workflow (.github/workflows/screenshots.yml, docs/screenshots.md).
// The app must be installed, built with EXPO_PUBLIC_SCREENSHOTS=1 so its
// setup screen exists. Run it with plain node, with adb on the PATH:
//
//   node scripts/emulator-screenshots.ts [output dir]   # default: screenshots
//
// It opens berean://dev-screenshots once (the catalog, the study Bible and
// this week's publications are downloaded for real; sample notes and
// workspaces are seeded), then for each variant (phone and tablet sizes,
// light and dark, large text) sets the emulator up with adb, opens each
// screen by deep link or by tapping its way there, waits for the screen to
// stop changing and saves <output>/<screen>/<variant>.png.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE = 'com.odonckers.berean.mobile';
const out = process.argv[2] ?? 'screenshots';

/** `type` is typed into whatever has focus once the screen is open. */
type Screen = { name: string; url: string; taps?: string[]; type?: string };

// John 1 in the Bible the setup installed; it reports the key as a
// "Bible: <pubKey>" line (src/screenshots/setup.ts).
const read = (pubKey: string) => `berean:///?pubKey=${encodeURIComponent(pubKey)}&book=43&chapter=1`;

export const SCREENS: Screen[] = [
  { name: 'read', url: read('{bible}') },
  { name: 'today', url: 'berean:///today' },
  { name: 'library', url: 'berean:///library' },
  { name: 'whats-new', url: 'berean:///library/whats-new' },
  // Find focuses its search field on open.
  { name: 'library-find', url: 'berean:///library/find', type: 'watchtower' },
  { name: 'notes', url: 'berean:///notes' },
  { name: 'studyspace', url: 'berean:///studyspace' },
  // /search is the iOS tab; Android opens search as its own screen.
  { name: 'search', url: 'berean:///search-view', type: 'shepherd' },
  { name: 'appearance', url: 'berean:///appearance' },
];

type Variant = { name: string; size?: string; density?: number; night: boolean; fontScale: number };

// The emulator is a Pixel 6 (1080x2400 at 420 dpi, 411x914 dp). The tablet
// is 1600x2560 at 320 dpi: 800x1280 dp, a medium-width window in portrait
// and expanded in landscape.
export const VARIANTS: Variant[] = [
  { name: 'phone-light', night: false, fontScale: 1 },
  { name: 'phone-dark', night: true, fontScale: 1 },
  // Android's largest font size.
  { name: 'phone-large-text', night: false, fontScale: 2 },
  { name: 'tablet-light', size: '1600x2560', density: 320, night: false, fontScale: 1 },
  { name: 'tablet-dark', size: '1600x2560', density: 320, night: true, fontScale: 1 },
  { name: 'tablet-landscape-light', size: '2560x1600', density: 320, night: false, fontScale: 1 },
];

function adb(...args: string[]): Buffer {
  return execFileSync('adb', args, { maxBuffer: 64 * 1024 * 1024 });
}

/** Runs a command line in the device shell (adb joins its arguments into one). */
function shell(command: string): string {
  return adb('shell', command).toString();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The on-screen accessibility tree, as uiautomator dumps it. */
function dump(): string {
  for (let attempt = 0; attempt < 3; attempt++) {
    const xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty').toString();
    if (xml.includes('<hierarchy')) return xml;
  }
  return '';
}

const unescape = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Every text and content description on screen. */
function texts(xml: string): string[] {
  return [...xml.matchAll(/ (?:text|content-desc)="([^"]*)"/g)].map((m) => unescape(m[1])).filter(Boolean);
}

/** Taps the first element whose text or content description is `label`, waiting for it to appear. */
async function tap(label: string) {
  for (let waited = 0; waited < 30_000; waited += 1000) {
    for (const node of dump().matchAll(/<node [^>]*>/g)) {
      const attrs = node[0];
      const named = [...attrs.matchAll(/ (?:text|content-desc)="([^"]*)"/g)].some((m) => unescape(m[1]) === label);
      const bounds = attrs.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (named && bounds) {
        const [x1, y1, x2, y2] = bounds.slice(1).map(Number);
        shell(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
        return;
      }
    }
    await sleep(1000);
  }
  throw new Error(`Nothing labelled “${label}” appeared on screen.`);
}

function open(url: string) {
  shell(`am start -W -a android.intent.action.VIEW -d '${url}' ${PACKAGE}`);
}

const screencap = () => adb('exec-out', 'screencap', '-p');

/** Waits until two screencaps a beat apart match, then returns the last one. */
async function settled(): Promise<Buffer> {
  await sleep(2500);
  let last = screencap();
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(800);
    const next = screencap();
    if (next.equals(last)) return next;
    last = next;
  }
  return last;
}

function applyVariant(v: Variant) {
  shell(v.size ? `wm size ${v.size}` : 'wm size reset');
  shell(v.density ? `wm density ${v.density}` : 'wm density reset');
  shell(`cmd uimode night ${v.night ? 'yes' : 'no'}`);
  shell(`settings put system font_scale ${v.fontScale}`);
}

/** A tidy status bar: fixed clock, full battery and signal, no notifications. */
function demoMode() {
  shell('settings put global sysui_demo_allowed 1');
  const demo = (args: string) => shell(`am broadcast -a com.android.systemui.demo -e command ${args}`);
  demo('enter');
  demo('clock -e hhmm 0941');
  demo('battery -e level 100 -e plugged false');
  demo('network -e wifi show -e level 4 -e mobile hide');
  demo('notifications -e visible false');
}

/** Prints what went wrong on the device: the screen's text and the app's log. */
function diagnose() {
  console.log('On screen:');
  for (const line of texts(dump())) console.log(`  ${line}`);
  console.log('App log (last lines):');
  const log = adb('logcat', '-d', '-v', 'brief', 'ReactNativeJS:V', 'ReactNative:W', 'AndroidRuntime:E', '*:F').toString();
  for (const line of log.trim().split('\n').slice(-60)) console.log(`  ${line}`);
}

/** Runs the in-app setup and returns the installed Bible's key. */
async function setup(): Promise<string> {
  console.log('Setting up: catalog, publications and sample notes…');
  const started = Date.now();
  open('berean:///dev-screenshots');
  const printed = new Set<string>();
  for (let waited = 0; waited < 25 * 60_000; waited += 5000) {
    const lines = texts(dump());
    for (const line of lines.filter((t) => t.startsWith('Screenshot setup') || t.includes(': '))) {
      if (printed.has(line)) continue;
      printed.add(line);
      console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${line}`);
    }
    const end = lines.find((t) => t.startsWith('Screenshot setup: done') || t.startsWith('Screenshot setup: failed'));
    if (end) {
      writeFileSync(join(out, 'setup.png'), screencap());
      if (end.includes('failed')) {
        diagnose();
        throw new Error(end);
      }
      const bible = lines.find((t) => t.startsWith('Bible: '))?.slice('Bible: '.length);
      if (bible === undefined) throw new Error('The setup did not report its Bible.');
      return bible;
    }
    await sleep(5000);
  }
  writeFileSync(join(out, 'setup.png'), screencap());
  diagnose();
  throw new Error('The screenshot setup did not finish within 25 minutes.');
}

async function main() {
  mkdirSync(out, { recursive: true });
  shell('settings put system screen_off_timeout 1800000');
  demoMode();
  const bible = await setup();
  for (const variant of VARIANTS) {
    applyVariant(variant);
    // Size, density and night mode restart the status bar, which drops demo mode.
    await sleep(3000);
    demoMode();
    for (const screen of SCREENS) {
      shell(`am force-stop ${PACKAGE}`);
      open(screen.url.replace(encodeURIComponent('{bible}'), encodeURIComponent(bible)));
      try {
        for (const label of screen.taps ?? []) {
          await sleep(2000);
          await tap(label);
        }
        if (screen.type) {
          await sleep(2000);
          shell(`input text '${screen.type}'`);
        }
      } catch (error) {
        console.log(`  ${screen.name}/${variant.name}: ${error instanceof Error ? error.message : error}`);
      }
      mkdirSync(join(out, screen.name), { recursive: true });
      writeFileSync(join(out, screen.name, `${variant.name}.png`), await settled());
      // Typing puts the device in keyboard mode, which draws focus rings on
      // the screens after it. A touch on the status bar ends that.
      if (screen.type) shell('input tap 1 1');
      console.log(`  ${screen.name}/${variant.name}`);
    }
  }
  applyVariant(VARIANTS[0]);
}

if (process.argv[1]?.endsWith('emulator-screenshots.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
