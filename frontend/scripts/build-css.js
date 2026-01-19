const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../src/styles');
const entryFile = path.join(srcDir, 'main.css');
const outputFile = path.resolve(__dirname, '../styles.css');

function bundleCss(entryPath, importedFiles = new Set()) {
    if (importedFiles.has(entryPath)) {
        return '';
    }
    importedFiles.add(entryPath);

    let content = fs.readFileSync(entryPath, 'utf8');
    // Regex to match @import url('...'); or @import url("...");
    const importRegex = /@import\s+url\(['"](.+?)['"]\);/g;

    return content.replace(importRegex, (match, importPath) => {
        // Resolve the path relative to the current file
        const absoluteImportPath = path.resolve(path.dirname(entryPath), importPath);
        console.log(`Bundling: ${absoluteImportPath}`);
        try {
            return bundleCss(absoluteImportPath, importedFiles);
        } catch (e) {
            console.warn(`Warning: Could not bundle ${absoluteImportPath}: ${e.message}`);
            return `/* Error bundling ${importPath} */`;
        }
    });
}

try {
    console.log('Starting CSS bundle...');
    // Ensure scripts directory exists (redundant if running from scripts dir, but good for safety)
    // The previous tool ensures directory creation, so we are good.

    if (!fs.existsSync(entryFile)) {
        throw new Error(`Entry file not found: ${entryFile}`);
    }

    const bundledCss = bundleCss(entryFile);
    fs.writeFileSync(outputFile, bundledCss);
    console.log(`CSS bundled successfully to ${outputFile}`);
} catch (error) {
    console.error('Failed to bundle CSS:', error);
    process.exit(1);
}
