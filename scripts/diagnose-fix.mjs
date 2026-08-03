/**
 * Verify the fix: use a space in empty page delimiters
 */
import { readFileSync } from "fs";

async function main() {
  // Simulate the fixed delimiter approach
  const pdfPath = "/Users/lizhao/workspace/DeepReader/test-vault/纳瓦尔宝典：财富与幸福指南 (埃里克．乔根森 (Eric Jorgenson)) (Z-Library).pdf";
  const pdfParse = (await import("pdf-parse")).default;
  const data = readFileSync(pdfPath);

  const render = async (pageData) => {
    const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    const items = textContent.items;
    if (!items || items.length === 0) {
      return "===PAGE_DELIMITER=== ===PAGE_DELIMITER_END===\n";  // FIXED: space between delimiters
    }

    const textItems = [];
    for (const item of items) {
      if (item.str == null) continue;
      const fs = Math.abs(item.transform[3]);
      if (fs <= 0) continue;
      textItems.push(item.str);
    }
    if (textItems.length === 0) {
      return "===PAGE_DELIMITER=== ===PAGE_DELIMITER_END===\n";  // FIXED
    }
    const text = textItems.join(" ");
    return "===PAGE_DELIMITER===" + text + "===PAGE_DELIMITER_END===\n";
  };

  const result = await pdfParse(data, { pagerender: render });
  const fullText = result.text || "";
  const pageMatches = [...fullText.matchAll(/===PAGE_DELIMITER===([\s\S]*?)===PAGE_DELIMITER_END===/g)];

  console.log(`Rendered: ${result.numpages}, Regex extracted: ${pageMatches.length}`);
  console.log(`Match: ${result.numpages === pageMatches.length ? "YES ✓" : "NO ✗"}`);

  // Check key pages alignment
  const keyChecks = [
    { page: 48, title: "承担责任" },
    { page: 50, title: "创立企业或买入股权" },
    { page: 53, title: "找到杠杆" },
    { page: 64, title: "用判断力赚钱" },
  ];

  console.log(`\n=== Key page alignment check ===\n`);
  for (const check of keyChecks) {
    const idx = check.page - 1;
    const pageText = (pageMatches[idx]?.[1] || "").substring(0, 100).trim();
    const found = pageText.includes(check.title) || pageText.includes(check.title.replace(/\s/g, ""));
    console.log(`  Page ${check.page} "${check.title}": ${found ? "✓ CORRECT" : "✗ MISMATCH"}`);
    console.log(`    Preview: ${pageText.substring(0, 80)}...`);
  }
}

main().catch(console.error);
