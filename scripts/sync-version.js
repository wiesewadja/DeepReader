const fs = require('fs');
const path = require('path');

/**
 * 从 package.json 读取版本号并同步到 manifest.json
 * 确保两个文件的版本号保持一致
 */

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const manifestJsonPath = path.join(rootDir, 'manifest.json');

try {
    // 读取 package.json
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const version = packageJson.version;

    console.log(`📦 package.json version: ${version}`);

    // 读取 manifest.json
    const manifestJson = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf8'));
    const oldVersion = manifestJson.version;

    console.log(`📄 manifest.json version: ${oldVersion}`);

    // 如果版本号不同，更新 manifest.json
    if (oldVersion !== version) {
        manifestJson.version = version;
        fs.writeFileSync(manifestJsonPath, JSON.stringify(manifestJson, null, 2));
        console.log(`✅ Updated manifest.json version: ${oldVersion} → ${version}`);
    } else {
        console.log(`✅ Versions are already in sync: ${version}`);
    }

} catch (error) {
    console.error('❌ Failed to sync version:', error.message);
    process.exit(1);
}