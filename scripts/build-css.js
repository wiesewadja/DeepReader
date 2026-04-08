const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../src/styles');
const entryFile = path.join(srcDir, 'main.css');
const outputDir = path.resolve(__dirname, '../bin');
const outputFile = path.join(outputDir, 'styles.css');

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
    
    // Ensure bin directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

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
