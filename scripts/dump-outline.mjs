/**
 * Dump PDF outline (bookmarks) to console
 * Usage: node scripts/dump-outline.mjs <pdf-path>
 */
import { readFileSync } from "fs";

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: node dump-outline.mjs <pdf-path>");
    process.exit(1);
  }

  const pdfParse = (await import("pdf-parse")).default;
  const data = readFileSync(pdfPath);

  let outline = null;
  const pagerender = async (pageData) => {
    if (!outline) {
      try {
        const doc = pageData.transport.pdfDocument;
        const rawOutline = await doc.getOutline();
        if (rawOutline?.length) {
          outline = await resolveOutline(rawOutline, doc);
        }
      } catch {}
    }
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

  if (!outline || outline.length === 0) {
    console.log("No outline/bookmarks found in PDF.");
    return;
  }

  function print(items, indent = 0) {
    for (const item of items) {
      const prefix = "  ".repeat(indent);
      console.log(`${prefix}- p${item.pageNumber}: ${item.title}`);
      if (item.children) print(item.children, indent + 1);
    }
  }

  console.log(`Found ${countItems(outline)} outline entries:\n`);
  print(outline);

  function countItems(items) {
    let n = items.length;
    for (const item of items) {
      if (item.children) n += countItems(item.children);
    }
    return n;
  }
}

main().catch(console.error);
