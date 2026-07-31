/**
 * RFC 4180 CSV parser — zero dependencies. Handles quoted fields with embedded
 * commas, newlines, and escaped double-quotes (`""` → `"`). Returns rows as
 * string arrays. The first row is typically the header (caller decides
 * rendering).
 *
 * @see https://tools.ietf.org/html/rfc4180
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // Doubled quote inside a quoted field → literal "
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        // Closing quote
        inQuotes = false;
        i++;
        continue;
      }
      // Any other char inside quotes (including newline) is part of the field
      field += char;
      i++;
      continue;
    }

    // Outside quotes
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    // Swallow \r (handle CRLF line endings → treat as \n)
    if (char === '\r') {
      i++;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += char;
    i++;
  }

  // Last field/row (if no trailing newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Remove trailing empty rows (from trailing newlines)
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  return rows;
}
