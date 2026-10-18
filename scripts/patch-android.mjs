#!/usr/bin/env node
/**
 * `npm run android:patch`
 *
 * Capacitor generates the `android/` project once with `npx cap add android` and
 * then never touches it again — which means the things this app needs have to be
 * patched in by hand, and patched in a way that survives being run twice (and
 * after a `cap sync`, which does not overwrite the manifest but does regenerate
 * other files).
 *
 * What it does, all idempotently:
 *   1. AndroidManifest: `adjustResize` for the keyboard, `chatbot://oauth`
 *      intent filter for the sign-in deep link, and the network security config.
 *   2. build.gradle: version name/code from package.json, and a release signing
 *      config read from `android/keystore.properties` when that file exists.
 *   3. Launcher icons, adaptive icon layers and the splash drawable, stamped in
 *      from `resources/android/` (run `npm run icons` first).
 *   4. A network security config that allows cleartext HTTP to loopback and
 *      private LAN addresses only, so a local Ollama works while everything else
 *      stays HTTPS-only.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const appDir = join(androidDir, 'app');
const resDir = join(appDir, 'src', 'main', 'res');
const manifestPath = join(appDir, 'src', 'main', 'AndroidManifest.xml');
const gradlePath = join(appDir, 'build.gradle');

const changes = [];

function read(file) {
  return readFileSync(file, 'utf8');
}

function writeIfChanged(file, next) {
  const before = existsSync(file) ? read(file) : '';
  if (before === next) return false;
  writeFileSync(file, next, 'utf8');
  return true;
}

function patchManifest() {
  let xml = read(manifestPath);
  let touched = false;

  // 1. Keyboard: resize the WebView rather than panning it behind the keyboard.
  if (!xml.includes('windowSoftInputMode')) {
    xml = xml.replace(/(<activity\b[^>]*android:name="\.MainActivity"[\s\S]*?)(\s*>)/, (match, head, tail) =>
      `${head}\n            android:windowSoftInputMode="adjustResize"${tail}`,
    );
    touched = true;
  }

  // 2. Deep link for the OAuth return trip.
  if (!xml.includes('chatbot:deep-links')) {
    const filter = `
            <!-- chatbot:deep-links — where the system browser returns after sign-in. -->
            <intent-filter android:label="@string/title_activity_main">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="chatbot" android:host="oauth" />
            </intent-filter>
`;
    xml = xml.replace(/\s*<\/activity>/, (match) => `${filter}        </activity>`);
    touched = true;
  }

  // 3. Local endpoints on plain HTTP (a desktop Ollama on the LAN).
  if (!xml.includes('networkSecurityConfig')) {
    xml = xml.replace(/(<application\b[^>]*?)(\s*>)/, (match, head, tail) => {
      // The attribute goes right after the opening tag name.
      return `${head}\n        android:networkSecurityConfig="@xml/network_security_config"${tail}`;
    });
    touched = true;
  }

  if (touched && writeIfChanged(manifestPath, xml)) changes.push('AndroidManifest.xml');
}

function patchGradle() {
  let gradle = read(gradlePath);
  let touched = false;

  const version = JSON.parse(read('package.json')).version;
  const [major = 1, minor = 0, patch = 0] = String(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  const versionCode = major * 10_000 + minor * 100 + patch;

  if (!gradle.includes('chatbot:version')) {
    gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode} // chatbot:version`);
    gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
    touched = true;
  }

  if (!gradle.includes('chatbot:signing')) {
    const signing = `
    // chatbot:signing — reads android/keystore.properties when it is present, so
    // a fresh clone still builds a debug APK without any secrets in the repo.
    def keystorePropertiesFile = rootProject.file("keystore.properties")
    def keystoreProperties = new Properties()
    if (keystorePropertiesFile.exists()) {
        keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
    }

    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }

    buildTypes {`;
    gradle = gradle.replace(/\n\s*buildTypes\s*\{/, signing);
    gradle = gradle.replace(/release\s*\{\n(\s*)minifyEnabled/, (match, indent) =>
      `release {\n${indent}if (keystorePropertiesFile.exists()) {\n${indent}    signingConfig signingConfigs.release\n${indent}}\n${indent}minifyEnabled`,
    );
    touched = true;
  }

  if (touched && writeIfChanged(gradlePath, gradle)) changes.push('app/build.gradle');
}

function networkSecurityConfig() {
  const file = join(resDir, 'xml', 'network_security_config.xml');
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Everything is HTTPS. The exceptions are loopback and private LAN addresses,
  which is where a local Ollama or a self-hosted OpenAI-compatible endpoint
  lives: Android blocks cleartext by default, and without this a local model
  would fail with a network error that looks like a bug in the app.
-->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
        <!-- The host machine, as seen from the Android emulator. -->
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">192.168.0.0</domain>
        <domain includeSubdomains="false">192.168.1.0</domain>
    </domain-config>
</network-security-config>
`;
  mkdirSync(dirname(file), { recursive: true });
  if (writeIfChanged(file, xml)) changes.push('res/xml/network_security_config.xml');
}

function stampIcons() {
  const source = join(root, 'resources', 'android');
  if (!existsSync(source)) {
    console.warn('  ! resources/android is missing — run `npm run icons` first, skipping icons.');
    return;
  }
  const digest = (file) => (existsSync(file) ? createHash('sha1').update(readFileSync(file)).digest('hex') : null);

  /** Copies only when the bytes differ, so a second run reports nothing. */
  const stamp = (from, to) => {
    if (!existsSync(from)) return false;
    if (digest(from) === digest(to)) return false;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    return true;
  };

  let count = 0;
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      if (stamp(join(source, `mipmap-${density}`, name), join(resDir, `mipmap-${density}`, name))) count += 1;
    }
  }
  if (stamp(join(source, 'drawable', 'splash.png'), join(resDir, 'drawable', 'splash.png'))) count += 1;
  if (count) changes.push(`${count} icon/splash files`);
}

function main() {
  if (!existsSync(androidDir)) {
    console.error('\nNo android/ folder. Run `npx cap add android` first.\n');
    process.exit(1);
  }
  if (!existsSync(manifestPath)) {
    console.error(`\nCould not find ${manifestPath}.\n`);
    process.exit(1);
  }

  patchManifest();
  patchGradle();
  networkSecurityConfig();
  stampIcons();

  if (!changes.length) {
    console.log('Android project already patched — nothing to do.');
  } else {
    console.log('Patched the Android project:');
    for (const change of changes) console.log(`  ✓ ${change}`);
  }

  const keystore = join(androidDir, 'keystore.properties');
  if (!existsSync(keystore)) {
    console.log(
      '\n  · No release signing key yet. Debug APKs build regardless; to sign a\n' +
        '    release bundle create android/keystore.properties (docs/native-builds.md).',
    );
  }
}

main();
