/** Simple CSV parse for plain comma-separated files. */
export function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) =>
      line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "").replace(/""/g, '"')),
    );
}

export function toCsvRow(cells: string[]): string {
  return cells
    .map((cell) => {
      const v = cell ?? "";
      if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    })
    .join(",");
}

export function toCsv(rows: string[][]): string {
  return rows.map(toCsvRow).join("\n");
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function csvFilename(prefix: string, bootcampName: string): string {
  const safe = bootcampName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "all";
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}-${safe}-${date}.csv`;
}
