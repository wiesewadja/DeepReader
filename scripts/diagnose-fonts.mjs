/**
 * Analyze font characteristics of titles vs body text in the PDF
 */
import { readFileSync } from "fs";

async function main() {
  const pdfPath = "/Users/lizhao/workspace/DeepReader/test-vault/纳瓦尔宝典：财富与幸福指南 (埃里克．乔根森 (Eric Jorgenson)) (Z-Library).pdf";
  const pdfParse = (await import("pdf-parse")).default;
  const data = readFileSync(pdfPath);

  let pageNum = 0;
  const render = async (pageData) => {
    pageNum++;
    if (pageNum >= 48 && pageNum <= 53) {
      const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      const items = textContent.items;

      // Collect font info
      const fontInfo = [];
      for (const item of items) {
        if (item.str == null || !item.str.trim()) continue;
        const fs = Math.abs(item.transform[3]);
        const isBold = item.fontName?.toLowerCase().includes('bold') || item.fontName?.toLowerCase().includes('heav');
        fontInfo.push({
          text: item.str.trim().substring(0, 30),
          fontSize: Math.round(fs * 100) / 100,
          fontName: item.fontName || '',
          isBold,
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
        });
      }

      console.log(`\n=== Page ${pageNum} (${fontInfo.length} items) ===`);
      // Find unique font sizes
      const sizes = [...new Set(fontInfo.map(i => i.fontSize))].sort((a, b) => b - a);
      console.log(`  Font sizes: ${sizes.join(', ')}`);

      // Show first 20 items with font info
      console.log(`  First items:`);
      for (let i = 0; i < Math.min(25, fontInfo.length); i++) {
        const info = fontInfo[i];
        const bold = info.isBold ? ' [BOLD]' : '';
        console.log(`    fs=${info.fontSize} x=${info.x} y=${info.y}${bold} font="${info.fontName}" → "${info.text}"`);
      }
    }
    return "";
  };

  await pdfParse(data, { pagerender: render });
}

main().catch(console.error);
