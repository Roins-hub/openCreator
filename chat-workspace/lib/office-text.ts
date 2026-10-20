/**
 * 在浏览器里读出 Word / Excel / PPT(.docx / .xlsx / .pptx)里的文字,作为文本发给模型。
 * 这些文件是 zip 包里放 XML:按 zip 目录找到需要的 XML,用浏览器自带的 DecompressionStream 解压,
 * 再从 XML 里取文字,不需要额外的库。旧版 .doc / .xls / .ppt 不是 zip,读不了。
 */

const MAX_CHARS = 200_000;

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number };

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 目录结尾记录在文件末尾(后面最多跟 64KB 注释)
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index--) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error("文件格式不对，请另存为 .docx / .xlsx / .pptx 后再试");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count && view.getUint32(cursor, true) === 0x02014b50; index++) {
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    entries.push({
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      offset: view.getUint32(cursor + 42, true),
      name: decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("文件用了不支持的压缩方式");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

const xml = (text: string) => new DOMParser().parseFromString(text, "application/xml");
const byTag = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagName(tag));
/** 文件名里的序号(slide12.xml → 12),用来按顺序排 */
const serial = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] || 0);

function wordText(doc: Document) {
  return byTag(doc, "w:p").map((paragraph) =>
    Array.from(paragraph.getElementsByTagName("*")).map((node) =>
      node.tagName === "w:t" ? node.textContent || "" : node.tagName === "w:tab" ? "\t" : node.tagName === "w:br" ? "\n" : "",
    ).join("")).join("\n");
}

async function docxText(bytes: Uint8Array, entries: ZipEntry[]) {
  const main = entries.find((entry) => entry.name === "word/document.xml");
  if (!main) throw new Error("没有找到 Word 正文");
  return wordText(xml(await readEntry(bytes, main)));
}

async function pptxText(bytes: Uint8Array, entries: ZipEntry[]) {
  const slides = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)).sort((a, b) => serial(a.name) - serial(b.name));
  const parts = await Promise.all(slides.map(async (slide, index) => {
    const doc = xml(await readEntry(bytes, slide));
    const lines = byTag(doc, "a:p").map((paragraph) => byTag(paragraph, "a:t").map((node) => node.textContent || "").join(""))
      .filter((line) => line.trim());
    return `## 第 ${index + 1} 页\n${lines.join("\n")}`;
  }));
  return parts.join("\n\n");
}

async function xlsxText(bytes: Uint8Array, entries: ZipEntry[]) {
  const shared: string[] = [];
  const strings = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  if (strings) {
    for (const item of byTag(xml(await readEntry(bytes, strings)), "si")) {
      shared.push(byTag(item, "t").map((node) => node.textContent || "").join(""));
    }
  }
  const book = entries.find((entry) => entry.name === "xl/workbook.xml");
  const names = book ? byTag(xml(await readEntry(bytes, book)), "sheet").map((sheet) => sheet.getAttribute("name") || "") : [];
  const sheets = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)).sort((a, b) => serial(a.name) - serial(b.name));
  const parts = await Promise.all(sheets.map(async (sheet, index) => {
    const rows = byTag(xml(await readEntry(bytes, sheet)), "row").map((row) => byTag(row, "c").map((cell) => {
      const type = cell.getAttribute("t");
      if (type === "inlineStr") return byTag(cell, "t").map((node) => node.textContent || "").join("");
      const value = cell.getElementsByTagName("v")[0]?.textContent || "";
      return type === "s" ? shared[Number(value)] ?? "" : value;
    }).join("\t")).filter((line) => line.trim());
    return `## ${names[index] || `工作表 ${index + 1}`}\n${rows.join("\n")}`;
  }));
  return parts.join("\n\n");
}

/** 读出 Office 文件的文字;太长时截断并注明 */
export async function officeText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = zipEntries(bytes);
  const extension = file.name.split(".").pop()?.toLowerCase();
  const text = extension === "xlsx" ? await xlsxText(bytes, entries)
    : extension === "pptx" ? await pptxText(bytes, entries)
      : await docxText(bytes, entries);
  const trimmed = text.trim();
  if (!trimmed) return "（文件里没有可读的文字）";
  return trimmed.length > MAX_CHARS ? `${trimmed.slice(0, MAX_CHARS)}\n…（内容过长，只取了前 ${MAX_CHARS} 个字符）` : trimmed;
}
