/**
 * Every map layer comes from NASA GIBS (Global Imagery Browse Services), no key needed.
 * If GIBS is unreachable, maps fall back to plain outlines from the bundled Natural Earth
 * country file (public domain), so nothing third-party is fetched.
 */
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

export const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

/** VIIRS Black Marble 2016 night lights (Suomi NPP Day/Night Band). */
export const BLACK_MARBLE = { url: `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`, max: 8, attr: "NASA GIBS · VIIRS Black Marble" };

/** Place labels and borders/coastlines (OpenStreetMap-derived reference layers served by GIBS). */
export const LABELS = { url: `${GIBS}/Reference_Labels_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`, max: 13 };
export const FEATURES = { url: `${GIBS}/Reference_Features_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`, max: 13 };

let atlasPromise: Promise<GeoJSON.FeatureCollection> | null = null;
/** Natural Earth 1:50m countries (bundled; used for click targets and the offline outline). */
export const loadAtlas = () =>
  (atlasPromise ??= import("world-atlas/countries-50m.json").then((m) => {
    const topo = (m.default ?? m) as unknown as Topology<{ countries: GeometryCollection }>;
    return feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection;
  }));
