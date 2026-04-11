/**
 * Check if render_page produces headings in page text
 */
import { readFileSync } from "fs";

async function main() {
  const pdfPath = "/Users/lizhao/workspace/deepreadertest/纳瓦尔宝典：财富与幸福指南 (埃里克．乔根森 (Eric Jorgenson)) (Z-Library).pdf";
  const pdfParse = (await import("pdf-parse")).default;
  const data = readFileSync(pdfPath);

  const pages = [];
  const render = async (pageData) => {
    const render_options = { normalizeWhitespace: false, disableCombineTextItems: false };
    const textContent = await pageData.getTextContent(render_options);
    await new Promise(r => setTimeout(r, 0));

    const items = textContent.items;
    if (!items || items.length === 0) return "===PAGE_DELIMITER=== ===PAGE_DELIMITER_END===\n";

    const textItems = [];
    for (const item of items) {
      if (item.str == null) continue;
      const fs = Math.abs(item.transform[3]);
      if (fs <= 0) continue;
      textItems.push({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        w: item.width || 0,
        fontSize: fs,
      });
    }
    if (textItems.length === 0) return "===PAGE_DELIMITER=== ===PAGE_DELIMITER_END===\n";

    // Sort
    textItems.sort((a, b) => {
      const dy = b.y - a.y;
      if (Math.abs(dy) > 3) return dy;
      return a.x - b.x;
    });

    // Find body font size
    const fontSizeCounts = new Map();
    for (const item of textItems) {
      if (!item.str.trim()) continue;
      const fs = Math.round(item.fontSize * 10) / 10;
      fontSizeCounts.set(fs, (fontSizeCounts.get(fs) || 0) + item.str.length);
    }
    let bodyFontSize = 12, maxLen = 0;
    for (const [fs, len] of fontSizeCounts) {
      if (len > maxLen) { maxLen = len; bodyFontSize = fs; }
    }
    const avgLineHeight = bodyFontSize * 1.2;

    // Group into lines, detect headings
    const lines = [];
    let lineBuf = '', lineMaxFont = bodyFontSize, lineEndX = 0, prevY = null;

    const flushLine = () => {
      const trimmed = lineBuf.trim();
      if (!trimmed) { lineBuf = ''; return; }
      if (lineMaxFont > bodyFontSize * 1.4) {
        if (lineMaxFont > bodyFontSize * 2.0) lines.push(`# ${trimmed}`);
        else if (lineMaxFont > bodyFontSize * 1.7) lines.push(`## ${trimmed}`);
        else lines.push(`### ${trimmed}`);
      } else {
        lines.push(trimmed);
      }
      lineBuf = ''; lineMaxFont = bodyFontSize;
    };

    for (let i = 0; i < textItems.length; i++) {
      const item = textItems[i];
      if (prevY === null) {
        lineBuf = item.str; lineMaxFont = item.fontSize;
        lineEndX = item.x + item.w; prevY = item.y; continue;
      }
      const yDiff = Math.abs(item.y - prevY);
      if (yDiff < avgLineHeight * 0.4) {
        const gap = item.x - lineEndX;
        if (gap > bodyFontSize * 0.15) lineBuf += ' ';
        lineBuf += item.str;
        lineEndX = item.x + item.w;
        if (item.fontSize > lineMaxFont) lineMaxFont = item.fontSize;
      } else {
        flushLine();
        if (yDiff > avgLineHeight * 1.5) lines.push('');
        lineBuf = item.str; lineMaxFont = item.fontSize;
        lineEndX = item.x + item.w; prevY = item.y;
      }
    }
    flushLine();

    const pageText = lines.join('\n');
    return "===PAGE_DELIMITER===" + pageText + "===PAGE_DELIMITER_END===\n";
  };

  const result = await pdfParse(data, { pagerender: render });
  const fullText = result.text || "";
  const pageMatches = [...fullText.matchAll(/===PAGE_DELIMITER===([\s\S]*?)===PAGE_DELIMITER_END===/g)];

  // Check pages 47-53 for headings
  console.log(`=== Page text with heading detection ===\n`);
  for (let i = 47; i <= 52; i++) {
    const pageText = pageMatches[i]?.[1] || "";
    const headingLines = pageText.split('\n').filter(l => l.startsWith('#'));
    console.log(`--- Page ${i + 1} (index ${i}) ---`);
    if (headingLines.length > 0) {
      console.log(`  Headings found:`);
      for (const h of headingLines) console.log(`    ${h}`);
    } else {
      console.log(`  No headings`);
    }
    // Show first 200 chars
    console.log(`  Preview: ${pageText.substring(0, 200).replace(/\n/g, '\\n')}`);
    console.log();
  }
}

main().catch(console.error);
