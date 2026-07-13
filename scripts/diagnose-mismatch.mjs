/**
 * Diagnose chapter-content mismatch
 * Traces: outline → TocItem → postProcessing (startIndex/endIndex) → page text
 */
import { readFileSync } from "fs";

async function main() {
  const pdfPath = "/Users/lizhao/workspace/DeepReader/test-vault/纳瓦尔宝典：财富与幸福指南 (埃里克．乔根森 (Eric Jorgenson)) (Z-Library).pdf";
  const pdfParse = (await import("pdf-parse")).default;
  const data = readFileSync(pdfPath);

  // Step 1: Extract outline (bookmarks)
  let outline = null;
  let pages = [];

  const pagerender = async (pageData) => {
    if (!outline) {
      try {
        const doc = pageData.transport.pdfDocument;
        const rawOutline = await doc.getOutline();
        if (rawOutline?.length) {
          outline = await resolveOutline(rawOutline, doc);
        }
      } catch (e) { console.error("outline error:", e); }
    }

    // Extract page text
    const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    const text = textContent.items.map(i => i.str).join(" ");
    pages.push(text);
    return "";
  };

  async function resolveOutline(items, doc) {
    const result = [];
    for (const item of items) {
      let pageNumber = 0;
      try {
        let dest = item.dest;
        if (typeof dest === "string") dest = await doc.getDestination(dest);
        if (Array.isArray(dest)) {
          const pageIdx = await doc.getPageIndex(dest[0]);
          pageNumber = pageIdx + 1;
        }
      } catch {}
      const children = item.items?.length ? await resolveOutline(item.items, doc) : [];
      result.push({ title: item.title, pageNumber, children: children.length ? children : undefined });
    }
    return result;
  }

  await pdfParse(data, { pagerender });
  console.log(`Total pages extracted: ${pages.length}\n`);

  // Step 2: Flatten outline to TocItems (mimicking outlineToTocItems)
  const tocItems = [];
  let listIndex = 0;
  function flatten(nodes, parentStructure) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const structure = parentStructure ? `${parentStructure}.${i + 1}` : `${i + 1}`;
      if (node.pageNumber > 0) {
        tocItems.push({
          structure,
          title: node.title,
          physicalIndex: node.pageNumber,
          listIndex: listIndex++,
        });
      }
      if (node.children?.length) flatten(node.children, structure);
    }
  }
  flatten(outline);

  console.log(`=== TocItems (${tocItems.length}) ===\n`);
  // Show key sections around the mismatch area
  const keyTitles = ["承担责任", "创立企业或买入股权", "找到杠杆", "用判断力赚钱"];
  for (const item of tocItems) {
    if (keyTitles.includes(item.title)) {
      console.log(`  [${item.listIndex}] "${item.title}" → physicalIndex=${item.physicalIndex}`);
    }
  }

  // Step 3: Show what text is on those specific pages
  console.log(`\n=== Page content at key physical indices ===\n`);
  for (const item of tocItems) {
    if (!keyTitles.includes(item.title)) continue;
    const pageIdx = item.physicalIndex - 1; // 0-based
    if (pageIdx >= 0 && pageIdx < pages.length) {
      const pageText = pages[pageIdx];
      const preview = pageText.substring(0, 200).replace(/\n/g, " ");
      console.log(`  Page ${item.physicalIndex} (index ${pageIdx}) — "${item.title}":`);
      console.log(`    Preview: ${preview}...`);
      // Check if title appears in this page
      const titleFound = pageText.includes(item.title) || pageText.includes(item.title.replace(/[？?]/g, ""));
      console.log(`    Title found on page: ${titleFound}`);
      console.log();
    }
  }

  // Step 4: Simulate postProcessing to see startIndex/endIndex
  console.log(`\n=== Simulated postProcessing (key sections) ===\n`);

  // Mimic addPrefaceIfNeeded + postProcessing
  function simulatePostProcessing(items, endPhysicalIndex) {
    const results = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const startIndex = item.physicalIndex;
      let endIndex;
      if (i < items.length - 1) {
        const nextItem = items[i + 1];
        // Default behavior when appearStart is undefined
        endIndex = nextItem.physicalIndex;
      } else {
        endIndex = endPhysicalIndex;
      }
      results.push({ ...item, startIndex, endIndex });
    }
    return results;
  }

  const processed = simulatePostProcessing(tocItems, pages.length);
  for (const item of processed) {
    if (!keyTitles.includes(item.title)) continue;
    console.log(`  "${item.title}": startIndex=${item.startIndex}, endIndex=${item.endIndex}`);
    console.log(`    Will read pages [${item.startIndex}..${item.endIndex}) (0-based: [${item.startIndex - 1}..${item.endIndex - 1}])`);
    // Show first 100 chars of what would be read
    let text = "";
    for (let p = item.startIndex - 1; p < item.endIndex - 1 && p < pages.length; p++) {
      text += pages[p]?.substring(0, 80) + "... ";
    }
    console.log(`    First content: ${text.substring(0, 200)}`);
    console.log();
  }

  // Step 5: Check the actual tree.json for comparison
  console.log(`\n=== Actual tree.json data ===\n`);
  try {
    const treeData = JSON.parse(readFileSync("/Users/lizhao/workspace/DeepReader/test-vault/.pageindex/74dca606/tree.json", "utf-8"));
    function findNodes(nodes, titles) {
      const found = [];
      for (const node of nodes) {
        if (titles.includes(node.title)) found.push(node);
        if (node.nodes) found.push(...findNodes(node.nodes, titles));
      }
      return found;
    }
    const matched = findNodes(treeData.structure, keyTitles);
    for (const node of matched) {
      console.log(`  "${node.title}": startIndex=${node.startIndex}, endIndex=${node.endIndex}`);
      if (node.text) {
        const preview = node.text.substring(0, 150).replace(/\n/g, " ");
        console.log(`    Text preview: ${preview}...`);
      }
      console.log();
    }
  } catch (e) {
    console.log("  Could not read tree.json:", e.message);
  }

  // Step 6: Full outline dump with page counts
  console.log(`\n=== Full outline with page ranges (first 30 entries) ===\n`);
  for (let i = 0; i < Math.min(30, processed.length); i++) {
    const item = processed[i];
    const pageCount = item.endIndex - item.startIndex;
    console.log(`  [${i}] p${item.startIndex}-p${item.endIndex} (${pageCount}p): ${item.title}`);
  }
}

main().catch(console.error);
