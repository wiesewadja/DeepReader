import AdmZip from "adm-zip";
import * as path from "path";
import * as fs from "fs";

const dirs = [
  "test-vault/DeepReader/assets",
  "/Users/lizhao/Nutstore Files/昭见森2030/DeepReader/assets",
];

function findEpub(keyword: string): string | null {
  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".epub"));
      const match = files.find(f => f.includes(keyword));
      if (match) return path.join(dir, match);
    } catch {}
  }
  return null;
}

async function main() {
  const keyword = process.argv[2];
  const epubPath = findEpub(keyword);
  if (!epubPath) { console.log("Not found"); return; }
  
  const zip = new AdmZip(epubPath);
  
  const containerXml = zip.getEntry("META-INF/container.xml")!.getData().toString();
  const opfPathMatch = containerXml.match(/full-path=["']([^"']+)["']/);
  const opfPath = opfPathMatch![1];
  const opfXml = zip.getEntry(opfPath)!.getData().toString();
  
  const spineMatches = [...opfXml.matchAll(/<itemref\s+idref="([^"]+)"/g)];
  const manifestMatches = [...opfXml.matchAll(/<item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"/g)];
  const manifestMap = new Map(manifestMatches.map(m => [m[1], m[2]]));
  
  for (const sm of spineMatches.slice(0, 5)) {
    const id = sm[1];
    const href = manifestMap.get(id);
    if (!href) { console.log(`  ${id}: no href`); continue; }
    const fullPath = path.join(path.dirname(opfPath), href).replace(/\\/g, "/");
    const entry = zip.getEntry(fullPath);
    if (!entry) { console.log(`  ${id}: entry not found ${fullPath}`); continue; }
    
    const html = entry.getData().toString("utf-8");
    console.log(`\n=== ${id} (${href}) size=${html.length} ===`);
    
    // Find all heading-like patterns
    const hTags = [...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
    const h1s = hTags.filter(m => m[0].match(/^<h1/i));
    console.log(`  <h1>-${h1s.length}, total headings: ${hTags.length}`);
    
    // Find ◆ patterns
    const diamonds = [...html.matchAll(/<p[^>]*>◆\s*([^<]+)/gi)];
    console.log(`  ◆ headings: ${diamonds.length}`);
    diamonds.slice(0, 10).forEach(m => console.log(`    ◆ ${m[1].trim().substring(0, 40)}`));
    
    // Find "第X章" patterns
    const chapters = [...html.matchAll(/第[一二三四五六七八九十百千\d]+章/g)];
    console.log(`  第X章 patterns: ${chapters.length}`);
    
    // Find bold-only short <p>
    const boldShort = [...html.matchAll(/<p[^>]*><(?:span class="[^"]*bold[^"]*"|b|strong)[^>]*>([^<]{1,60})<\/(?:span|b|strong)><\/p>/gi)];
    console.log(`  Bold short paragraphs: ${boldShort.length}`);
    boldShort.slice(0, 10).forEach(m => console.log(`    B: ${m[1].trim().substring(0, 40)}`));
    
    // Show first 2000 chars
    console.log(`\n  First 2000 chars:`);
    console.log(html.substring(0, 2000));
  }
}

main().catch(console.error);
