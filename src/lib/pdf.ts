import { jsPDF } from "jspdf";
import { heat } from "./color";
import { MONTHS, formatBBox } from "./regions";
import type { AoiAnalysis, GridFile } from "./types";

/** Renders the analyst's Markdown brief plus key metrics into a one/two-page PDF. */
export function downloadBriefPdf(opts: { brief: string; regionName: string; analysis: AoiAnalysis; meta: GridFile["meta"] }) {
  const { brief, regionName, analysis: a, meta } = opts;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const clean = (s: string) =>
    s.replace(/\*\*|__|`/g, "").replace(/→/g, "->").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[^\x20-\x7E°–—•×±]/g, "");

  // Header band
  doc.setFillColor(11, 15, 23);
  doc.rect(0, 0, W, 92, "F");
  const grad = [[239, 68, 68], [249, 115, 22], [245, 158, 11]];
  grad.forEach((c, i) => {
    doc.setFillColor(c[0], c[1], c[2]);
    doc.rect((W / 3) * i, 92, W / 3 + 1, 3, "F");
  });
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("FireCal AI", M, 40);
  doc.setFontSize(11);
  doc.setTextColor(253, 186, 116);
  doc.text("RESPONDER EARLY-WARNING BRIEF", M, 58);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(156, 163, 175);
  doc.setFontSize(9);
  doc.text(`${clean(regionName)}  |  ${clean(formatBBox(a.bbox))}`, M, 76);
  doc.text(`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, W - M, 40, { align: "right" });
  doc.text(meta.source === "sample" ? "DATA: SYNTHETIC DEMO" : "DATA: NASA FIRMS MODIS + VIIRS", W - M, 56, { align: "right" });

  // KPI tiles
  let y = 116;
  const tiles = [
    ["Peak season", `${MONTHS[a.peakMonths[0] - 1]}-${MONTHS[a.peakMonths[1] - 1]}`],
    ["Trend", a.trend.significant ? `${a.trend.senSlope > 0 ? "+" : ""}${a.trend.senSlope}/yr` : "No sig. trend"],
    ["Calibration k", `${a.k}x`],
    ["Top anomaly", a.anomalies[0] ? `${MONTHS[a.anomalies[0].month - 1]} ${a.anomalies[0].year}` : "None"],
  ];
  const tw = (W - 2 * M - 3 * 10) / 4;
  tiles.forEach(([label, value], i) => {
    const x = M + i * (tw + 10);
    doc.setFillColor(248, 245, 241);
    doc.roundedRect(x, y, tw, 48, 6, 6, "F");
    doc.setFontSize(8);
    doc.setTextColor(120, 113, 108);
    doc.text(label.toUpperCase(), x + 10, y + 16);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(17, 24, 39);
    doc.text(value, x + 10, y + 36);
    doc.setFont("helvetica", "normal");
  });

  // Climatology bars
  y += 70;
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text("MEAN HARMONIZED FIRE-DAYS BY MONTH", M, y);
  y += 8;
  const max = Math.max(...a.climatology.map((c) => c.mean), 1);
  const bw = (W - 2 * M) / 12;
  a.climatology.forEach((c, i) => {
    const h = (c.mean / max) * 60;
    const col = heat(0.25 + 0.75 * (c.mean / max)).match(/\d+/g)!.map(Number);
    doc.setFillColor(col[0], col[1], col[2]);
    doc.rect(M + i * bw + 3, y + 60 - h, bw - 6, Math.max(h, 1), "F");
    doc.setFontSize(7);
    doc.setTextColor(107, 114, 128);
    doc.text(MONTHS[i], M + i * bw + bw / 2, y + 72, { align: "center" });
  });
  y += 96;

  // Brief body
  const lineH = 13;
  const ensure = (need: number) => {
    if (y + need > H - 50) {
      doc.addPage();
      y = 50;
    }
  };
  for (const raw of brief.split("\n")) {
    const line = raw.trim();
    if (!line) {
      y += 4;
      continue;
    }
    if (line.startsWith("# ")) continue; // title already in the header
    if (line.startsWith("## ")) {
      ensure(30);
      y += 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(234, 88, 12);
      doc.text(clean(line.slice(3)).toUpperCase(), M, y);
      y += lineH + 2;
      continue;
    }
    const bullet = /^[-*•]\s+/.test(line) || /^\d+[.)]\s+/.test(line);
    const body = clean(line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(31, 41, 55);
    const indent = bullet ? 14 : 0;
    const wrapped = doc.splitTextToSize(body, W - 2 * M - indent) as string[];
    ensure(wrapped.length * lineH);
    if (bullet) {
      doc.setFillColor(249, 115, 22);
      doc.circle(M + 4, y - 3.5, 2, "F");
    }
    wrapped.forEach((w) => {
      doc.text(w, M + indent, y);
      y += lineH;
    });
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(156, 163, 175);
    doc.text(
      "Harmonized MODIS (1 km) + VIIRS (375 m) active-fire record. Fire-days = unique 0.01° cells x days with nominal/high-confidence detections. AI-generated; verify before operational use.",
      M,
      H - 24,
      { maxWidth: W - 2 * M - 40 },
    );
    doc.text(`${p}/${pages}`, W - M, H - 24, { align: "right" });
  }

  const slug = regionName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  doc.save(`firecal-brief-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
