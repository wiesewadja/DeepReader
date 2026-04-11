/**
 * Count empty pages and check alignment
 */
import { readFileSync } from "fs";

async function main() {
  const pdfPath = "/Users/lizhao/workspace/deepreadertest/纳瓦尔宝典：财富与幸福指南 (埃里克．乔根森 (Eric Jorgenson)) (Z-Library).pdf";
  const pdfParse = (await import("pdf-parse")).default;
  const data = readFileSync(pdfPath);

  let pageTexts = [];
  let emptyCount = 0;

  const render = async (pageData) => {
    const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    const items = textContent.items;

    if (!items || items.length === 0) {
      pageTexts.push({ text: "", empty: true });
      emptyCount++;
      return "===PAGE_DELIMITER=====PAGE_DELIMITER_END===\n";
    }

    const text = items.map(i => i.str).join(" ");
    pageTexts.push({ text: text.substring(0, 80), empty: text.trim().length === 0 });
    return "===PAGE_DELIMITER===" + text + "===PAGE_DELIMITER_END===\n";
  };

  const result = await pdfParse(data, { pagerender: render });

  // Now parse what pdf-parse returns
  const fullText = result.text || "";
  const pageMatches = [...fullText.matchAll(/===PAGE_DELIMITER===([\s\S]*?)===PAGE_DELIMITER_END===/g)];

  console.log(`Rendered pages: ${pageTexts.length}`);
  console.log(`Regex matches: ${pageMatches.length}`);
  console.log(`Empty pages: ${emptyCount}`);
  console.log(`pdf-parse numpages: ${result.numpages}`);

  // Find which pages were empty
  console.log(`\nEmpty pages:`);
  for (let i = 0; i < pageTexts.length; i++) {
    if (pageTexts[i].empty) {
      console.log(`  Page ${i + 1}: EMPTY`);
    }
  }

  // The issue: when a page returns "===PAGE_DELIMITER=====PAGE_DELIMITER_END===\n"
  // the regex captures empty content between them. But does pdf-parse actually
  // call the render function for all pages?

  // Let's check: does the regex match count equal rendered pages?
  console.log(`\nRendered ${pageTexts.length} vs Regex extracted ${pageMatches.length}`);
  console.log(`Difference: ${pageTexts.length - pageMatches.length} pages lost`);

  // Check: do consecutive empty delimiters get merged?
  // ===PAGE_DELIMITER=====PAGE_DELIMITER_END===\n===PAGE_DELIMITER===...
  // The regex is lazy: [\s\S]*? — should match "" for empty pages
  // BUT: what if pdf-parse doesn't call the render function for some pages?

  // Verify: check if there are gaps in page rendering
  console.log(`\nFirst 10 pages comparison:`);
  for (let i = 0; i < Math.min(10, pageTexts.length); i++) {
    const rendered = pageTexts[i].text.substring(0, 50).trim();
    const extracted = (pageMatches[i]?.[1] || "").substring(0, 50).trim();
    const match = rendered === extracted ? "✓" : "✗";
    console.log(`  Page ${i + 1} ${match}: rendered="${rendered}" vs extracted="${extracted}"`);
  }
}

main().catch(console.error);
