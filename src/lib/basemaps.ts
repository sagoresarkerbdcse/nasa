/**
 * Keyless basemap sources. (CARTO's basemaps.cartocdn.com now stamps "API KEY
 * REQUIRED" over its tiles, so it is no longer used.)
 */
export const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

/** Esri dark-gray canvas: free with attribution, no key. */
export const DARK_BASE = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  max: 16,
  attr: "Esri, HERE, Garmin, © OpenStreetMap contributors",
};

/** NASA GIBS place labels and borders/coastlines (OpenStreetMap-derived), transparent PNG overlays. */
export const LABELS = { url: `${GIBS}/Reference_Labels_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`, max: 13 };
export const FEATURES = { url: `${GIBS}/Reference_Features_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`, max: 13 };
