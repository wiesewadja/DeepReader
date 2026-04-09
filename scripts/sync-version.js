const fs = require('fs');
const path = require('path');

/**
 * 从 package.json 读取版本号并同步到 manifest.json
 * 确保两个文件的版本号保持一致
 */

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const binDir = path.join(rootDir, 'bin');
const manifestJsonPath = path.join(binDir, 'manifest.json');

// manifest 模板内容
const MANIFEST_TEMPLATE = {
    "id": "deepreader",
    "name": "DeepReader",
    "minAppVersion": "1.0.0",
    "description": "智能深度阅读插件，支持 PDF/EPUB 等格式的索引、搜索与 AI 对话",
    "author": "DeepReader Team",
    "authorUrl": "https://github.com/deepreader",
    "isDesktopOnly": true
};

try {
    // 确保 bin 目录存在
    if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const version = packageJson.version;
    const manifest = { ...MANIFEST_TEMPLATE, version };

    fs.writeFileSync(manifestJsonPath, JSON.stringify(manifest, null, 2));
    console.log(`✅ Generated bin/manifest.json with version: ${version}`);

} catch (error) {
    console.error('❌ Failed to generate manifest:', error.message);
    process.exit(1);
}