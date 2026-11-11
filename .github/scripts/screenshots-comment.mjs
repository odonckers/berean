// Posts a screenshots.yml run's images (the Expo app on Android) or an
// exact.yml run's (the Exact app on the iOS Simulator) on its PR, each in a
// comment of its own (screenshots-comment.yml, docs/screenshots.md). Runs
// from main with a write token, on an artifact that PR code made, so it
// trusts nothing in that artifact but what it checks here:
// - only PNG files named <screen>/<variant>.png (lowercase, digits and
//   dashes) and a small pr.json; any other file, a link or a bad PNG fails
//   the run;
// - the PR number in pr.json must belong to a PR whose head is the commit
//   the run captured (for a manual run, the number someone with write
//   access typed in);
// - the comment is built here, from those names only.
// Images go to the ci-screenshots branch, under pr-<n>/<run id>/ (Android)
// or pr-<n>-ios/<run id>/ (iOS), and that branch is rewritten as one commit
// that keeps each PR's latest run of each.

import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

const BRANCH = 'ci-screenshots';
const IMAGE = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}\.png$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_FILES = 150;
const MAX_IMAGE = 4 * 1024 * 1024;
const MAX_TOTAL = 80 * 1024 * 1024;

// What each capturing workflow posts, by its name.
const KINDS = {
  screenshots: {
    marker: '<!-- berean-screenshots -->',
    heading: 'Screenshots',
    dir: (pr) => `pr-${pr}`,
    intro: (commit, runLink) =>
      `${commit} on an Android emulator: a Pixel 6 phone and a 1600×2560 tablet, at half size. Tap one to open it; the full-size set is in the screenshots-full artifact of ${runLink}. Review these before merging (docs/screenshots.md).`,
    screens: ['read', 'today', 'library', 'notes', 'studyspace', 'search', 'appearance'],
    titles: { read: 'Read', today: 'Today', library: 'Library', notes: 'Notes', studyspace: 'Studyspace', search: 'Search', appearance: 'Appearance' },
    rows: [
      [
        ['phone-light', 'Phone, light', 220],
        ['phone-dark', 'Phone, dark', 220],
        ['phone-large-text', 'Phone, largest text', 220],
      ],
      [
        ['tablet-light', 'Tablet, light', 260],
        ['tablet-dark', 'Tablet, dark', 260],
        ['tablet-landscape-light', 'Tablet, landscape', 420],
      ],
    ],
  },
  exact: {
    marker: '<!-- berean-screenshots-ios -->',
    heading: 'iOS screenshots (Exact)',
    dir: (pr) => `pr-${pr}-ios`,
    intro: (commit, runLink) =>
      `${commit} of the Exact app (apps/berean) on the iOS Simulator: an iPhone 17 Pro and an 11-inch iPad Pro. Tap one to open it at full size; the set is also in the screenshots-ios artifact of ${runLink}. Review these before merging (docs/screenshots.md).`,
    screens: ['library', 'read', 'tapped'],
    titles: { library: 'Library', read: 'Read', tapped: 'Read, after tapping a verse' },
    rows: [
      [
        ['phone-light', 'iPhone, light', 200],
        ['phone-dark', 'iPhone, dark', 200],
        ['phone-large-text', 'iPhone, largest text', 200],
      ],
      [
        ['tablet-light', 'iPad, light', 280],
        ['tablet-dark', 'iPad, dark', 280],
      ],
    ],
  },
};

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const token = env('GITHUB_TOKEN');
const repo = env('GITHUB_REPOSITORY');
const artifactDir = env('ARTIFACT_DIR');
const workDir = env('WORK_DIR');
const event = JSON.parse(readFileSync(env('GITHUB_EVENT_PATH'), 'utf8'));
const run = event.workflow_run;
const kind = KINDS[run.name];
if (!kind) throw new Error(`No screenshots kind for workflow ${JSON.stringify(run.name)}`);
const MARKER = kind.marker;

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  console.log(text);
}

async function api(method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

/** Every file in the artifact, checked. Returns the image paths, sorted. */
function checkArtifact() {
  const images = [];
  let total = 0;
  let files = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const rel = relative(artifactDir, path).split('\\').join('/');
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Link in the artifact: ${JSON.stringify(rel)}`);
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      if (!stat.isFile()) throw new Error(`Not a file: ${JSON.stringify(rel)}`);
      if (++files > MAX_FILES) throw new Error('Too many files in the artifact');
      total += stat.size;
      if (total > MAX_TOTAL) throw new Error('The artifact is too large');
      if (rel === 'pr.json') {
        if (stat.size > 4096) throw new Error('pr.json is too large');
        continue;
      }
      if (!IMAGE.test(rel)) throw new Error(`Unexpected file in the artifact: ${JSON.stringify(rel)}`);
      if (stat.size > MAX_IMAGE) throw new Error(`Image too large: ${rel}`);
      const head = readFileSync(path).subarray(0, PNG.length);
      if (!head.equals(PNG)) throw new Error(`Not a PNG: ${rel}`);
      images.push(rel);
    }
  };
  walk(artifactDir);
  return images.sort();
}

function readDescription() {
  const path = join(artifactDir, 'pr.json');
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const pr = typeof data.pr === 'string' && /^[1-9][0-9]{0,6}$/.test(data.pr) ? Number(data.pr) : undefined;
  const sha = typeof data.captured_sha === 'string' && /^[0-9a-f]{40}$/.test(data.captured_sha) ? data.captured_sha : undefined;
  return { pr, sha };
}

/** The PR to post on, or undefined. Never takes the artifact's word alone. */
async function findPullRequest(claimed) {
  if (claimed === undefined) return undefined;
  if (run.event === 'pull_request') {
    const pr = await api('GET', `/repos/${repo}/pulls/${claimed}`);
    if (pr.head.sha !== run.head_sha) {
      summary(`PR #${claimed}'s head is now ${pr.head.sha.slice(0, 7)}, not the captured ${run.head_sha.slice(0, 7)}; a newer run will post.`);
      return undefined;
    }
    return claimed;
  }
  // A manual run: only people with write access can start one, and the
  // number is the one they typed.
  if (run.event === 'workflow_dispatch' && run.head_repository?.full_name === repo) return claimed;
  return undefined;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
}

/** Puts the images on the ci-screenshots branch; returns their base URL. */
function publish(pr, images) {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  git(workDir, 'init', '-q');
  git(workDir, 'config', 'user.name', 'github-actions[bot]');
  git(workDir, 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
  git(workDir, 'config', 'http.https://github.com/.extraheader', `AUTHORIZATION: basic ${auth}`);
  git(workDir, 'remote', 'add', 'origin', `https://github.com/${repo}.git`);
  try {
    git(workDir, 'fetch', '-q', '--depth', '1', 'origin', BRANCH);
    git(workDir, 'checkout', '-q', 'FETCH_HEAD');
  } catch {
    console.log(`No ${BRANCH} branch yet; starting it.`);
  }
  const dir = `${kind.dir(pr)}/${run.id}`;
  rmSync(join(workDir, kind.dir(pr)), { recursive: true, force: true });
  for (const image of images) {
    mkdirSync(join(workDir, dir, image.split('/')[0]), { recursive: true });
    cpSync(join(artifactDir, image), join(workDir, dir, image));
  }
  git(workDir, 'checkout', '-q', '--orphan', 'snapshot');
  git(workDir, 'add', '-A');
  git(workDir, 'commit', '-q', '-m', `Screenshots for #${pr} (run ${run.id})`);
  git(workDir, 'push', '-q', '--force', 'origin', `snapshot:refs/heads/${BRANCH}`);
  return `https://raw.githubusercontent.com/${repo}/${BRANCH}/${dir}`;
}

function gallery(images, base) {
  const byScreen = new Map();
  for (const image of images) {
    const [screen, file] = image.split('/');
    if (!byScreen.has(screen)) byScreen.set(screen, new Set());
    byScreen.get(screen).add(file.slice(0, -'.png'.length));
  }
  const { screens, titles, rows: ROWS } = kind;
  const order = [...screens.filter((s) => byScreen.has(s)), ...[...byScreen.keys()].filter((s) => !screens.includes(s)).sort()];
  const known = new Set(ROWS.flat().map(([v]) => v));
  const cell = (screen, variant, width) => {
    const url = `${base}/${screen}/${variant}.png`;
    return `<td><a href="${url}"><img src="${url}" width="${width}" alt="${screen} ${variant}"></a></td>`;
  };
  const sections = order.map((screen) => {
    const variants = byScreen.get(screen);
    const rows = [...ROWS, [...variants].filter((v) => !known.has(v)).sort().map((v) => [v, v, 220])]
      .map((row) => row.filter(([v]) => variants.has(v)))
      .filter((row) => row.length > 0)
      .map(
        (row) =>
          `<tr>${row.map(([, title]) => `<th>${title}</th>`).join('')}</tr>\n<tr>${row.map(([v, , width]) => cell(screen, v, width)).join('')}</tr>`,
      );
    const title = titles[screen] ?? screen;
    return `<details><summary><b>${title}</b></summary>\n\n<table>\n${rows.join('\n')}\n</table>\n\n</details>`;
  });
  return sections.join('\n');
}

async function upsertComment(pr, body) {
  let existing;
  for (let page = 1; page <= 10 && !existing; page++) {
    const comments = await api('GET', `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`);
    existing = comments.find((c) => c.user?.login === 'github-actions[bot]' && c.body?.includes(MARKER));
    if (comments.length < 100) break;
  }
  if (existing) await api('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
  else await api('POST', `/repos/${repo}/issues/${pr}/comments`, { body });
  summary(`${existing ? 'Updated' : 'Posted'} the screenshots comment on #${pr}.`);
}

async function main() {
  const runLink = `[run ${run.id}](${run.html_url})`;
  const hasArtifact = existsSync(artifactDir);
  const images = hasArtifact ? checkArtifact() : [];
  const { pr: claimed, sha } = hasArtifact ? readDescription() : {};
  const pr = await findPullRequest(claimed);
  const commit = (sha ?? run.head_sha).slice(0, 7);

  if (run.conclusion !== 'success' || images.length === 0) {
    const body = `${MARKER}\n### ${kind.heading}\n\nThe capture failed for ${commit}, so there are no new screenshots. See ${runLink}.`;
    if (pr) await upsertComment(pr, body);
    else summary(body);
    return;
  }

  if (!pr) {
    summary(`Captured ${images.length} screenshots of ${commit} (${runLink}). No PR to post them on; they are in the run's artifacts.`);
    return;
  }

  const base = publish(pr, images);
  const body = [
    MARKER,
    `### ${kind.heading}`,
    '',
    kind.intro(commit, runLink),
    '',
    gallery(images, base),
  ].join('\n');
  await upsertComment(pr, body);
  summary(body);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
