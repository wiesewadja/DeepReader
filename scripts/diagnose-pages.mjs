/**
 * Diagnose page array alignment
 * Check if pages[i] corresponds to PDF page (i+1)
 */
import { readFileSync } from "fs";

async function main() {
  const pdfPath = "/Users/lizhao/workspace/deepreadertest/纳瓦尔宝典：财富与幸福指南 (埃里克．乔根森 (Eric Jorgenson)) (Z-Library).pdf";

  // Method 1: Simple text extraction (current pdf-parse approach)
  const pdfParse = (await import("pdf-parse")).default;
  const data = readFileSync(pdfPath);

  let simplePages = [];
  const simpleRender = async (pageData) => {
    const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    const text = textContent.items.map(i => i.str).join(" ");
    simplePages.push(text);
    return "";
  };
  await pdfParse(data, { pagerender: simpleRender });

  // Method 2: DeepReader's actual approach (with page delimiters)
  let deepreaderPages = [];
  let pageCount = 0;
  const deepreaderRender = async (pageData) => {
    pageCount++;
    const render_options = {
      normalizeWhitespace: false,
      disableCombineTextItems: false
    };
    const textContent = await pageData.getTextContent(render_options);
    await new Promise(r => setTimeout(r, 0));

    const items = textContent.items;
    if (!items || items.length === 0) {
      return "===PAGE_DELIMITER=====PAGE_DELIMITER_END===\n";
    }

    // Sort and build text (simplified version of DeepReader's render_page)
    const textItems = [];
    for (const item of items) {
      const s = item.str;
      if (s === undefined || s === null) continue;
      const fs = Math.abs(item.transform[3]);
      if (fs <= 0) continue;
      textItems.push({ str: s, x: item.transform[4], y: item.transform[5], w: item.width || 0, fontSize: fs });
    }
    textItems.sort((a, b) => {
      const dy = b.y - a.y;
      if (Math.abs(dy) > 3) return dy;
      return a.x - b.x;
    });

    const lines = [];
    for (const item of textItems) {
      const trimmed = item.str.trim();
      if (trimmed) lines.push(trimmed);
    }
    const pageText = lines.join('\n');
    return "===PAGE_DELIMITER===" + pageText + "===PAGE_DELIMITER_END===\n";
  };

  const result2 = await pdfParse(data, { pagerender: deepreaderRender });
  const fullText = result2.text || "";
  const pageMatches = [...fullText.matchAll(/===PAGE_DELIMITER===([\s\S]*?)===PAGE_DELIMITER_END===/g)];
  for (const match of pageMatches) {
    let pageText = match[1];
    pageText = pageText.replace(/===?PAGE_DELIMITER(?:_END?)?===?/g, "");
    deepreaderPages.push(pageText);
  }

  console.log(`Simple extraction: ${simplePages.length} pages`);
  console.log(`DeepReader extraction: ${deepreaderPages.length} pages from ${pageCount} rendered, regex matches: ${pageMatches.length}`);
  console.log(`pdf-parse numpages: ${result2.numpages}`);

  // Compare key pages
  const keyPages = [47, 48, 49, 50, 51, 52]; // 0-based for "承担责任"(p48=idx47), "创立企业或买入股权"(p50=idx49)
  console.log(`\n=== Comparing key pages ===\n`);

  for (const idx of keyPages) {
    const pageNum = idx + 1;
    const simplePreview = simplePages[idx]?.substring(0, 120).replace(/\n/g, " ") || "EMPTY";
    const drPreview = deepreaderPages[idx]?.substring(0, 120).replace(/\n/g, " ") || "EMPTY";

    console.log(`--- Page ${pageNum} (index ${idx}) ---`);
    console.log(`  Simple:   ${simplePreview}`);
    console.log(`  DeepReader: ${drPreview}`);

    // Check alignment
    const simpleTitle = findTitle(simplePages[idx] || "");
    const drTitle = findTitle(deepreaderPages[idx] || "");
    console.log(`  Detected title (simple): ${simpleTitle}`);
    console.log(`  Detected title (DR):     ${drTitle}`);
    console.log();
  }

  function findTitle(text) {
    const titles = ["承担责任", "创立企业或买入股权", "找到杠杆", "投资交友，着眼长远"];
    for (const t of titles) {
      if (text.includes(t)) return t;
    }
    return "(none found)";
  }

  // Check if there's an off-by-one alignment issue
  console.log(`\n=== Alignment check: does simplePages[i] == deepreaderPages[i]? ===\n`);
  let mismatches = 0;
  for (let i = 0; i < Math.min(60, simplePages.length, deepreaderPages.length); i++) {
    const sFirst30 = (simplePages[i] || "").substring(0, 30).trim();
    const dFirst30 = (deepreaderPages[i] || "").substring(0, 30).trim();
    if (sFirst30 !== dFirst30) {
      mismatches++;
      if (mismatches <= 10) {
        console.log(`  Page ${i + 1} MISMATCH:`);
        console.log(`    Simple: "${sFirst30}"`);
        console.log(`    DR:     "${dFirst30}"`);
      }
    }
  }
  console.log(`\nTotal mismatches in first 60 pages: ${mismatches}`);
}

main().catch(console.error);
