/**
 * Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, embedded
 * newlines, CRLF, a UTF-8 BOM, and comma or semicolon delimiters (Strong
 * uses semicolons in some locales). Returns rows of strings.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const delim = count(firstLine, ";") > count(firstLine, ",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** Rows as objects keyed by (trimmed) header. */
export function csvRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const [head, ...body] = parseCsv(text);
  const headers = (head ?? []).map((h) => h.trim());
  return { headers, records: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}
