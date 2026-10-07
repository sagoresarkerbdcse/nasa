import type { BBox, Region } from "./types";

/** Data domain: Bangladesh plus the border fire belts in NE India and Myanmar. */
export const DOMAIN: BBox = [88.0, 20.5, 92.75, 26.75];

export const REGIONS: Region[] = [
  {
    id: "sylhet",
    name: "Sylhet Division",
    short: "Sylhet",
    bbox: [90.5, 23.9, 92.5, 25.3],
    blurb: "Haor wetlands and tea estates bordering the Meghalaya and Assam hill fire belts.",
  },
  {
    id: "sundarbans",
    name: "Sundarbans",
    short: "Sundarbans",
    bbox: [88.75, 21.5, 89.95, 22.5],
    blurb: "The world's largest mangrove forest. Rare but damaging dry-season fires in the east.",
  },
  {
    id: "cht",
    name: "Chittagong Hill Tracts",
    short: "CHT",
    bbox: [91.6, 21.25, 92.7, 23.75],
    blurb: "Jhum (shifting) cultivation burns peak each March-April across the hills.",
  },
  {
    id: "domain",
    name: "Bangladesh & Border Belt",
    short: "Full domain",
    bbox: DOMAIN,
    blurb: "Whole study area including West Bengal, Tripura, Mizoram and Rakhine border fires.",
  },
];

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function bboxCenter(b: BBox): [number, number] {
  return [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2]; // [lat, lon] for Leaflet
}

export function formatBBox(b: BBox): string {
  const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;
  return `${f(b[1], "N", "S")} ${f(b[0], "E", "W")} → ${f(b[3], "N", "S")} ${f(b[2], "E", "W")}`;
}
