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

    // 优先从根目录读取 manifest 模板（保留 description 等字段）
    // 如果根目录不存在，则从 bin/ 读取
    let rootManifest;
    if (fs.existsSync(rootManifestPath)) {
        rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'));
    } else if (fs.existsSync(binManifestPath)) {
        rootManifest = JSON.parse(fs.readFileSync(binManifestPath, 'utf8'));
        console.log('Created root manifest from bin/manifest.json');
    } else {
        // 如果都不存在，使用 package.json 的 name 和 description 作为基础
        rootManifest = {
            name: packageJson.name || 'deepreader',
            version: version,
            description: packageJson.description || ''
        };
        console.log('Created new manifest from package.json');
    }

    const manifest = { ...rootManifest, version };

    // 同时写入根目录和 bin/
    fs.writeFileSync(rootManifestPath, JSON.stringify(manifest, null, '\t') + '\n');
    fs.writeFileSync(binManifestPath, JSON.stringify(manifest, null, '\t') + '\n');
    console.log(`Synced manifest.json with version: ${version}`);

} catch (error) {
    console.error('Failed to sync manifest:', error.message);
    process.exit(1);
}