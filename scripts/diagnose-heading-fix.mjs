/**
 * Verify heading detection with the new logic
 */
import { readFileSync } from "fs";

async function main() {
  const pdfPath = "/Users/lizhao/workspace/deepreadertest/纳瓦尔宝典：财富与幸福指南 (埃里克．乔根森 (Eric Jorgenson)) (Z-Library).pdf";
  const pdfParse = (await import("pdf-parse")).default;
  const data = readFileSync(pdfPath);

  const pages = [];
  const render = async (pageData) => {
    const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    await new Promise(r => setTimeout(r, 0));

    const items = textContent.items;
    if (!items || items.length === 0) return "===PAGE_DELIMITER=== ===PAGE_DELIMITER_END===\n";

    const textItems = [];
    for (const item of items) {
      if (item.str == null) continue;
      const fs = Math.abs(item.transform[3]);
      if (fs <= 0) continue;
      textItems.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width || 0, fontSize: fs });
    }
    if (textItems.length === 0) return "===PAGE_DELIMITER=== ===PAGE_DELIMITER_END===\n";

    textItems.sort((a, b) => { const dy = b.y - a.y; if (Math.abs(dy) > 3) return dy; return a.x - b.x; });

    const fontSizeCounts = new Map();
    for (const item of textItems) { if (!item.str.trim()) continue; const fs = Math.round(item.fontSize * 10) / 10; fontSizeCounts.set(fs, (fontSizeCounts.get(fs) || 0) + item.str.length); }
    let bodyFontSize = 12, maxLen = 0;
    for (const [fs, len] of fontSizeCounts) { if (len > maxLen) { maxLen = len; bodyFontSize = fs; } }
    const avgLineHeight = bodyFontSize * 1.2;

    const lines = [];
    let lineBuf = '', lineMaxFont = bodyFontSize, lineEndX = 0, lineItemCount = 0, prevY = null;

    const flushLine = () => {
      const trimmed = lineBuf.trim();
      if (!trimmed) { lineBuf = ''; lineItemCount = 0; return; }
      const fontRatio = lineMaxFont / bodyFontSize;
      const isHeading = fontRatio > 1.4 || (fontRatio > 1.2 && lineItemCount >= 2 && lineItemCount <= 20 && trimmed.length <= 30);
      if (isHeading || fontRatio > 1.4) {
        if (fontRatio > 2.0) lines.push(`# ${trimmed}`);
        else if (fontRatio > 1.7) lines.push(`## ${trimmed}`);
        else lines.push(`### ${trimmed}`);
      } else {
        lines.push(trimmed);
      }
      lineBuf = ''; lineMaxFont = bodyFontSize; lineItemCount = 0;
    };

    for (let i = 0; i < textItems.length; i++) {
      const item = textItems[i];
      if (prevY === null) { lineBuf = item.str; lineMaxFont = item.fontSize; lineEndX = item.x + item.w; lineItemCount = 1; prevY = item.y; continue; }
      const yDiff = Math.abs(item.y - prevY);
      if (yDiff < avgLineHeight * 0.4) {
        const gap = item.x - lineEndX;
        if (gap > bodyFontSize * 0.15) lineBuf += ' ';
        lineBuf += item.str; lineEndX = item.x + item.w;
        if (item.fontSize > lineMaxFont) lineMaxFont = item.fontSize;
        lineItemCount++;
      } else {
        flushLine();
        if (yDiff > avgLineHeight * 1.5) lines.push('');
        lineBuf = item.str; lineMaxFont = item.fontSize; lineEndX = item.x + item.w; lineItemCount = 1; prevY = item.y;
      }
    }
    flushLine();
    return "===PAGE_DELIMITER===" + lines.join('\n') + "===PAGE_DELIMITER_END===\n";
  };

  const result = await pdfParse(data, { pagerender: render });
  const fullText = result.text || "";
  const pageMatches = [...fullText.matchAll(/===PAGE_DELIMITER===([\s\S]*?)===PAGE_DELIMITER_END===/g)];

  // Check headings in pages 47-65
  console.log(`=== Heading detection results ===\n`);
  let totalHeadings = 0;
  for (let i = 47; i < Math.min(66, pageMatches.length); i++) {
    const pageText = pageMatches[i]?.[1] || "";
    const headingLines = pageText.split('\n').filter(l => l.startsWith('#'));
    if (headingLines.length > 0) {
      totalHeadings += headingLines.length;
      console.log(`Page ${i + 1}:`);
      for (const h of headingLines) console.log(`  ${h}`);
    }
  }
  console.log(`\nTotal headings detected: ${totalHeadings}`);
}

main().catch(console.error);
