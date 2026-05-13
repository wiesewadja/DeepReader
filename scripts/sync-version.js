const fs = require('fs');
const path = require('path');

/**
 * 从 package.json 读取版本号并同步到 manifest.json
 * 确保两个文件的版本号保持一致
 */

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const binDir = path.join(rootDir, 'bin');
const rootManifestPath = path.join(rootDir, 'manifest.json');
const binManifestPath = path.join(binDir, 'manifest.json');

try {
    // 确保 bin 目录存在
    if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const version = packageJson.version;

    // 从根目录 manifest.json 读取模板（保留 description 等字段）
    const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'));
    const manifest = { ...rootManifest, version };

    // 同时写入根目录和 bin/
    fs.writeFileSync(rootManifestPath, JSON.stringify(manifest, null, '\t') + '\n');
    fs.writeFileSync(binManifestPath, JSON.stringify(manifest, null, '\t') + '\n');
    console.log(`Synced manifest.json with version: ${version}`);

} catch (error) {
    console.error('Failed to sync manifest:', error.message);
    process.exit(1);
}