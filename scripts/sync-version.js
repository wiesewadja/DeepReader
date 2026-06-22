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
        // manifest 模板缺失时，用 Obsidian 插件必需字段重建。
        // ⚠️ 必须包含 id —— 缺失会导致 Obsidian 静默加载失败（manifest.id 须与插件目录名一致）
        //    （曾因 fallback 只带 package.json 的 name/description 而丢 id，污染过 origin/main 基线）
        rootManifest = {
            id: 'deepreader',
            name: 'DeepReader',
            version: version,
            description: packageJson.description || '',
            minAppVersion: '1.0.0',
            author: 'DeepReader Team',
            authorUrl: 'https://github.com/wiesewadja/DeepReader',
            isDesktopOnly: false,
        };
        console.warn('⚠️ manifest.json 模板缺失，已用默认值重建（请核对 id/author 等字段）');
    }

    const manifest = { ...rootManifest, version };

    // id 是 Obsidian 插件加载的必需字段（缺失 → 插件静默加载失败 + S-RES 校验失败）。
    // fail-fast：宁可构建失败，也不生成残缺 manifest 静默污染基线。
    if (!manifest.id) {
        console.error('❌ manifest.json 缺少 id 字段，Obsidian 将无法加载插件。请补全 manifest.json');
        process.exit(1);
    }

    // 同时写入根目录和 bin/
    fs.writeFileSync(rootManifestPath, JSON.stringify(manifest, null, '\t') + '\n');
    fs.writeFileSync(binManifestPath, JSON.stringify(manifest, null, '\t') + '\n');
    console.log(`Synced manifest.json with version: ${version}`);

} catch (error) {
    console.error('Failed to sync manifest:', error.message);
    process.exit(1);
}