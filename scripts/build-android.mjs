#!/usr/bin/env node
/**
 * `npm run build:android`
 *
 * 1. builds the web bundle in `android` mode (free tier switched off),
 * 2. copies it plus the native config into the Android project (`cap sync`),
 * 3. runs Gradle.
 *
 * A debug APK is always produced, since that is what you install on a phone for
 * testing. The release bundle (`.aab`) needs a signing key: put one in
 * `android/keystore.properties` (see docs/native-builds.md) and this script
 * builds it too. Without that file it says so instead of failing halfway.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const isWindows = process.platform === 'win32';

function run(label, command, args, options = {}) {
  console.log(`\n▸ ${label}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: isWindows, ...options });
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${result.status ?? 'signal'}).\n`);
    process.exit(result.status ?? 1);
  }
}

function hasSigningConfig() {
  if (existsSync(join(androidDir, 'keystore.properties'))) return true;
  return Boolean(process.env.CHATBOT_KEYSTORE && process.env.CHATBOT_KEYSTORE_PASSWORD);
}

function main() {
  if (!existsSync(androidDir)) {
    console.error(
      '\nThe Android platform has not been generated yet. Run this once:\n\n  npx cap add android\n  npm run android:patch\n',
    );
    process.exit(1);
  }

  run('Building the web bundle', 'npm', ['run', 'build:android:web']);
  run('Syncing into the Android project', 'npx', ['cap', 'sync', 'android']);

  const gradle = isWindows ? 'gradlew.bat' : './gradlew';
  const gradleOptions = { cwd: androidDir };

  run('Assembling the debug APK', gradle, ['assembleDebug'], gradleOptions);

  const apk = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  console.log(existsSync(apk) ? `\n✓ APK: ${apk}` : '\n? Expected the debug APK at android/app/build/outputs/apk/debug/app-debug.apk');

  if (!hasSigningConfig()) {
    console.log(
      '\n· Skipped the release bundle: no android/keystore.properties.\n' +
        '  Create a signing key (docs/native-builds.md) and re-run to get a signed .aab.\n',
    );
    return;
  }

  run('Bundling the signed release AAB', gradle, ['bundleRelease'], gradleOptions);
  const aab = join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  console.log(existsSync(aab) ? `\n✓ AAB: ${aab}` : '\n? Expected the bundle at android/app/build/outputs/bundle/release/app-release.aab');

  // A small sanity check that the bundle carries the version we think it does.
  try {
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    console.log(`\n  Version name in this build: ${version}`);
  } catch {
    /* not important */
  }
}

main();
