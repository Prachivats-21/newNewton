#!/usr/bin/env node

/**
 * build.js - Automated Minifier and Code Validator for newNewton
 * 
 * Flow:
 * 1. Pre-build validation: checks TypeScript and JavaScript files.
 * 2. Minification pipeline:
 *    - JavaScript: Terser with compression and mangling (preserving ES module exports).
 *    - CSS: esbuild minification.
 *    - JSON: Compaction and verification.
 * 3. Post-build validation: verifies that all minified JavaScript passes `node --check`.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const EXT_SRC_DIR = path.join(ROOT_DIR, 'extension');
const OUT_DIR = path.join(ROOT_DIR, 'dist', 'extension');

console.log('🚀 Starting newNewton Build & Minification Pipeline...\n');

// ============================================================================
// STEP 1: VALIDATE TYPESCRIPT & JAVASCRIPT
// ============================================================================
console.log('📋 Step 1: Validating TypeScript & JavaScript code...');

// 1.1 Check TypeScript (Supabase Edge Functions / project TS)
const tsFiles = [
  path.join(ROOT_DIR, 'supabase', 'functions', 'sync-quizzes', 'index.ts')
].filter(f => fs.existsSync(f));

for (const tsFile of tsFiles) {
  const relPath = path.relative(ROOT_DIR, tsFile);
  try {
    // If Deno is available, run deno check; otherwise check with esbuild/tsc
    let checked = false;
    try {
      execSync(`deno check --node-modules-dir=auto "${tsFile}"`, { stdio: 'pipe' });
      checked = true;
      console.log(`  ✓ TypeScript (deno check) passed: ${relPath}`);
    } catch (e) {
      // Fallback
    }

    if (!checked) {
      try {
        execSync(`npx --yes esbuild "${tsFile}" --bundle --platform=neutral --external:jsr:* --external:npm:* --outfile=/dev/null`, { stdio: 'pipe' });
        console.log(`  ✓ TypeScript (esbuild syntax check) passed: ${relPath}`);
      } catch (err2) {
        throw new Error(`TypeScript check failed: ${err2.message}`);
      }
    }
  } catch (err) {
    console.error(`  ❌ TypeScript validation failed for ${relPath}:`);
    console.error(err.stdout ? err.stdout.toString() : err.message);
    process.exit(1);
  }
}

// 1.2 Check Source JavaScript files
function getFilesRecursively(dir, extFilter) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath, extFilter));
    } else if (!extFilter || extFilter.some(ext => file.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

const sourceJsFiles = getFilesRecursively(EXT_SRC_DIR, ['.js']);
for (const jsFile of sourceJsFiles) {
  const relPath = path.relative(ROOT_DIR, jsFile);
  try {
    execSync(`node --check "${jsFile}"`, { stdio: 'pipe' });
    console.log(`  ✓ JavaScript syntax check passed: ${relPath}`);
  } catch (err) {
    console.error(`  ❌ JavaScript check failed for ${relPath}:`, err.message);
    process.exit(1);
  }
}

// ============================================================================
// STEP 2: STAGE & MINIFY EXTENSION
// ============================================================================
console.log('\n📦 Step 2: Staging and minifying extension to dist/extension...');

// Clean and prepare output directory
if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// Copy all files from extension to dist/extension
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name.startsWith('.')) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDirRecursive(EXT_SRC_DIR, OUT_DIR);

// List of ES Module files vs Classic Scripts
const esmFiles = [
  'src/background.js',
  'src/popup.js',
  'src/quiz-client.js',
  'src/attendance/grouping.js',
  'src/attendance/math.js',
  'src/attendance/portal-api.js'
];

let totalOriginalBytes = 0;
let totalMinifiedBytes = 0;

// Minify JavaScript files
const stagedJsFiles = getFilesRecursively(OUT_DIR, ['.js']);
console.log('\n⚡ Minifying JavaScript files with Terser:');

for (const filePath of stagedJsFiles) {
  const relFromOut = path.relative(OUT_DIR, filePath);
  const originalSize = fs.statSync(filePath).size;
  totalOriginalBytes += originalSize;

  const isModule = esmFiles.includes(relFromOut);
  const terserArgs = isModule
    ? '--module --compress --mangle'
    : '--compress --mangle';

  try {
    execSync(`npx --yes terser "${filePath}" ${terserArgs} -o "${filePath}"`, { stdio: 'pipe' });
    const minifiedSize = fs.statSync(filePath).size;
    totalMinifiedBytes += minifiedSize;

    const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
    console.log(`  ✓ ${relFromOut}: ${originalSize} B -> ${minifiedSize} B (-${savings}%) [${isModule ? 'ESM' : 'Classic'}]`);
  } catch (err) {
    console.error(`  ❌ Failed to minify ${relFromOut}:`, err.message);
    process.exit(1);
  }
}

// Minify CSS files
const stagedCssFiles = getFilesRecursively(OUT_DIR, ['.css']);
console.log('\n🎨 Minifying CSS files with esbuild:');

for (const filePath of stagedCssFiles) {
  const relFromOut = path.relative(OUT_DIR, filePath);
  const originalSize = fs.statSync(filePath).size;
  totalOriginalBytes += originalSize;

  try {
    execSync(`npx --yes esbuild "${filePath}" --minify --outfile="${filePath}" --allow-overwrite`, { stdio: 'pipe' });
    const minifiedSize = fs.statSync(filePath).size;
    totalMinifiedBytes += minifiedSize;

    const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
    console.log(`  ✓ ${relFromOut}: ${originalSize} B -> ${minifiedSize} B (-${savings}%)`);
  } catch (err) {
    console.error(`  ❌ Failed to minify ${relFromOut}:`, err.message);
    process.exit(1);
  }
}

// Minify JSON files
const stagedJsonFiles = getFilesRecursively(OUT_DIR, ['.json']);
console.log('\n📄 Compacting JSON files:');

for (const filePath of stagedJsonFiles) {
  const relFromOut = path.relative(OUT_DIR, filePath);
  const originalSize = fs.statSync(filePath).size;
  totalOriginalBytes += originalSize;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    // Keep manifest.json formatted cleanly, compact others like menu.json
    const formatted = (relFromOut === 'manifest.json')
      ? JSON.stringify(parsed, null, 2)
      : JSON.stringify(parsed);
    fs.writeFileSync(filePath, formatted);

    const minifiedSize = fs.statSync(filePath).size;
    totalMinifiedBytes += minifiedSize;

    const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
    console.log(`  ✓ ${relFromOut}: ${originalSize} B -> ${minifiedSize} B (-${savings}%)`);
  } catch (err) {
    console.error(`  ❌ Failed to compact ${relFromOut}:`, err.message);
    process.exit(1);
  }
}

// ============================================================================
// STEP 3: POST-MINIFICATION INTEGRITY & VALIDATION
// ============================================================================
console.log('\n🔍 Step 3: Verifying minified distribution integrity...');

for (const filePath of stagedJsFiles) {
  const relFromOut = path.relative(OUT_DIR, filePath);
  try {
    execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
    console.log(`  ✓ Minified file verified (node --check): ${relFromOut}`);
  } catch (err) {
    console.error(`  ❌ Integrity verification failed for minified ${relFromOut}:`, err.message);
    process.exit(1);
  }
}

const manifestPath = path.join(OUT_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('  ❌ Missing manifest.json in output directory!');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
console.log(`  ✓ Verified manifest.json (v${manifest.version}, ID key present: ${Boolean(manifest.key)})`);

const totalSavings = ((1 - totalMinifiedBytes / totalOriginalBytes) * 100).toFixed(1);
console.log(`\n🎉 Build and Minification Complete!`);
console.log(`   Total Size: ${totalOriginalBytes} B -> ${totalMinifiedBytes} B (-${totalSavings}% total reduction)`);
console.log(`   Output Directory: dist/extension`);
