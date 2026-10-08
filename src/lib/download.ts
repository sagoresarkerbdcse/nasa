import type { AoiAnalysis } from "./types";

/** Monthly harmonized record of the current area as CSV (same columns as the open dataset). */
export function analysisCsv(a: AoiAnalysis, name: string): string {
  const head = ["area", "year", "month", "modis_fire_days", "viirs_fire_days", "harmonized_fire_days", "harmonized_lo90", "harmonized_hi90", "source", "pct_vs_10yr", "anomaly"];
  const rows = a.months
    .filter((m) => !m.missing)
    .map((m) => [name, m.year, m.month, m.modisFD, m.viirsFD, m.harmonized, m.lo ?? "", m.hi ?? "", m.lo !== undefined ? "modis_harmonized" : "viirs_observed", m.pctVsBaseline ?? "", m.anomaly ?? ""]);
  const esc = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const meta = [
    `# FireCal harmonized active-fire record: ${name}`,
    `# Harmonization ${a.harmonization?.method ?? "v1"}; trained on ${a.harmonization ? a.harmonization.trainYears.join("-") : `${a.overlapYears[0]}-${a.overlapYears[1]}`}; intervals are 90%`,
    "# Source: NASA FIRMS MODIS C6.1 + VIIRS S-NPP 375 m. Licence CC BY 4.0. Methods: ATBD.md",
  ];
  return [...meta, head.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n") + "\n";
}

export function downloadText(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
