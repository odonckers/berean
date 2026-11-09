#!/usr/bin/env node
// Berean has one product version, kept in sync across the Expo app and the
// Rust core. This script reads, checks and sets it.
//
//   node scripts/release/version.mjs            print the version; fail if files disagree
//   node scripts/release/version.mjs check X    also fail unless the version is X
//                                              (X may carry a leading "v", as a tag does)
//   node scripts/release/version.mjs set X      write X everywhere (and Android's versionCode)
//
// The Apple apps keep their own version in apple/project.yml for now.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const path = (p) => join(root, p);

const CRATES = ["berean-core", "berean-ffi", "uniffi-bindgen"];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parse(version) {
  const v = version.replace(/^v/, "");
  const m = SEMVER.exec(v);
  if (!m) throw new Error(`"${version}" is not a plain MAJOR.MINOR.PATCH version`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (minor > 999 || patch > 999) throw new Error(`minor and patch must be below 1000 (${v})`);
  return { version: v, major, minor, patch };
}

// Android needs a strictly increasing integer. 1.2.3 -> 1002003.
export function versionCode({ major, minor, patch }) {
  return major * 1_000_000 + minor * 1_000 + patch;
}

const readJson = (p) => JSON.parse(readFileSync(path(p), "utf8"));
const writeJson = (p, data) => writeFileSync(path(p), JSON.stringify(data, null, 2) + "\n");

function crateVersion(crate) {
  const toml = readFileSync(path(`core/${crate}/Cargo.toml`), "utf8");
  const m = /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms.exec(toml);
  if (!m) throw new Error(`no [package] version in core/${crate}/Cargo.toml`);
  return m[1];
}

function lockVersion(crate) {
  const lock = readFileSync(path("core/Cargo.lock"), "utf8");
  const m = new RegExp(`^name = "${crate}"\\nversion = "([^"]+)"`, "m").exec(lock);
  if (!m) throw new Error(`${crate} not found in core/Cargo.lock`);
  return m[1];
}

function readAll() {
  const app = readJson("apps/mobile/app.json").expo;
  const pkg = readJson("apps/mobile/package.json");
  const lock = readJson("apps/mobile/package-lock.json");
  const found = {
    "apps/mobile/app.json expo.version": app.version,
    "apps/mobile/package.json version": pkg.version,
    "apps/mobile/package-lock.json version": lock.version,
    'apps/mobile/package-lock.json packages[""].version': lock.packages[""].version,
  };
  for (const c of CRATES) {
    found[`core/${c}/Cargo.toml version`] = crateVersion(c);
    found[`core/Cargo.lock ${c}`] = lockVersion(c);
  }
  return { found, versionCode: app.android?.versionCode };
}

function check(expected) {
  const { found, versionCode: code } = readAll();
  const values = new Set(Object.values(found));
  const problems = [];
  if (values.size !== 1) {
    problems.push("The version differs between files:");
    for (const [where, v] of Object.entries(found)) problems.push(`  ${v.padEnd(10)} ${where}`);
  }
  const [version] = values;
  if (expected !== undefined && values.size === 1 && version !== parse(expected).version) {
    problems.push(`The files say ${version}, expected ${parse(expected).version}.`);
  }
  if (values.size === 1) {
    const want = versionCode(parse(version));
    if (code !== want) {
      problems.push(`apps/mobile/app.json expo.android.versionCode is ${code}, expected ${want} for ${version}.`);
    }
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error("\nFix with: node scripts/release/version.mjs set <version>");
    process.exit(1);
  }
  console.log(version);
}

function set(input) {
  const v = parse(input);

  // app.json is edited as text so its hand formatting survives.
  const appPath = path("apps/mobile/app.json");
  let app = readFileSync(appPath, "utf8");
  app = app.replace(/^(  "expo": \{\n(?:.*\n)*?    "version": )"[^"]*"/m, `$1"${v.version}"`);
  if (/"versionCode": \d+/.test(app)) {
    app = app.replace(/"versionCode": \d+/, `"versionCode": ${versionCode(v)}`);
  } else {
    app = app.replace(/^(    "android": \{\n)/m, `$1      "versionCode": ${versionCode(v)},\n`);
  }
  writeFileSync(appPath, app);
  const written = JSON.parse(app).expo;
  if (written.version !== v.version || written.android?.versionCode !== versionCode(v)) {
    throw new Error("could not set the version in apps/mobile/app.json");
  }

  const pkg = readJson("apps/mobile/package.json");
  pkg.version = v.version;
  writeJson("apps/mobile/package.json", pkg);

  const lock = readJson("apps/mobile/package-lock.json");
  lock.version = v.version;
  lock.packages[""].version = v.version;
  writeJson("apps/mobile/package-lock.json", lock);

  for (const c of CRATES) {
    const p = path(`core/${c}/Cargo.toml`);
    const toml = readFileSync(p, "utf8");
    const next = toml.replace(/^(\[package\][^[]*?^version\s*=\s*)"[^"]+"/ms, `$1"${v.version}"`);
    if (next === toml && crateVersion(c) !== v.version) throw new Error(`could not set the version in ${p}`);
    writeFileSync(p, next);
  }

  const lockPath = path("core/Cargo.lock");
  let cargoLock = readFileSync(lockPath, "utf8");
  for (const c of CRATES) {
    cargoLock = cargoLock.replace(
      new RegExp(`^(name = "${c}"\\nversion = )"[^"]+"`, "m"),
      `$1"${v.version}"`,
    );
  }
  writeFileSync(lockPath, cargoLock);

  check(v.version);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === undefined) check();
  else if (command === "check" && arg) check(arg);
  else if (command === "set" && arg) set(arg);
  else {
    console.error("usage: version.mjs [check <version> | set <version>]");
    process.exit(2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
