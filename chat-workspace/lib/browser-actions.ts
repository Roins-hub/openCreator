const FALLBACK_INPUT_STYLES: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  inset: "0 auto auto -9999px",
  width: "1px",
  height: "1px",
  opacity: "0",
  pointerEvents: "none",
};

const copyWithSelectionFallback = (text: string) => {
  if (typeof document === "undefined" || !document.body) return false;

  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const previousRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const textarea = document.createElement("textarea");

  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, FALLBACK_INPUT_STYLES);
  document.body.appendChild(textarea);

  let copied = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    selection?.removeAllRanges();
    previousRanges.forEach((range) => selection?.addRange(range));
    activeElement?.focus({ preventScroll: true });
  }

  return copied;
};

export const copyTextToClipboard = async (text: string) => {
  if (!text) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Cross-origin iframes commonly block clipboard-write. The selection
      // fallback below still works when the click has user activation.
    }
  }

  return copyWithSelectionFallback(text);
};

const LANGUAGE_FILE_TYPES: Record<string, { extension: string; mime: string }> = {
  bash: { extension: "sh", mime: "text/x-shellscript" },
  c: { extension: "c", mime: "text/x-c" },
  cpp: { extension: "cpp", mime: "text/x-c++src" },
  css: { extension: "css", mime: "text/css" },
  csv: { extension: "csv", mime: "text/csv" },
  go: { extension: "go", mime: "text/x-go" },
  html: { extension: "html", mime: "text/html" },
  java: { extension: "java", mime: "text/x-java-source" },
  javascript: { extension: "js", mime: "text/javascript" },
  js: { extension: "js", mime: "text/javascript" },
  json: { extension: "json", mime: "application/json" },
  jsx: { extension: "jsx", mime: "text/jsx" },
  markdown: { extension: "md", mime: "text/markdown" },
  md: { extension: "md", mime: "text/markdown" },
  mermaid: { extension: "mmd", mime: "text/plain" },
  php: { extension: "php", mime: "text/x-php" },
  plaintext: { extension: "txt", mime: "text/plain" },
  powershell: { extension: "ps1", mime: "text/plain" },
  python: { extension: "py", mime: "text/x-python" },
  py: { extension: "py", mime: "text/x-python" },
  rust: { extension: "rs", mime: "text/x-rust" },
  shell: { extension: "sh", mime: "text/x-shellscript" },
  sql: { extension: "sql", mime: "application/sql" },
  svg: { extension: "svg", mime: "image/svg+xml" },
  text: { extension: "txt", mime: "text/plain" },
  ts: { extension: "ts", mime: "text/typescript" },
  tsx: { extension: "tsx", mime: "text/tsx" },
  typescript: { extension: "ts", mime: "text/typescript" },
  xml: { extension: "xml", mime: "application/xml" },
  yaml: { extension: "yaml", mime: "application/yaml" },
  yml: { extension: "yml", mime: "application/yaml" },
};

const sanitizeFilename = (filename: string) => {
  const leaf = filename.split(/[\\/]/).at(-1)?.trim() ?? "";
  return Array.from(leaf)
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 160);
};

export const fileDetailsForCode = (
  language: string | undefined,
  requestedFilename?: string | null,
) => {
  const normalizedLanguage = language?.toLowerCase() ?? "text";
  const type = LANGUAGE_FILE_TYPES[normalizedLanguage] ?? {
    extension:
      normalizedLanguage === "unknown"
        ? "txt"
        : normalizedLanguage.replace(/[^a-z0-9]+/g, "") || "txt",
    mime: "text/plain",
  };
  const safeRequestedFilename = requestedFilename ? sanitizeFilename(requestedFilename) : "";

  return {
    filename: safeRequestedFilename || `generated.${type.extension}`,
    mime: `${type.mime};charset=utf-8`,
  };
};

export const downloadTextFile = (content: string, filename: string, mime: string) => {
  if (typeof document === "undefined" || typeof URL === "undefined") return false;

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 40_000);
  return true;
};
