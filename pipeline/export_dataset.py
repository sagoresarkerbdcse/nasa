"""
Package the FireCal Harmonized Active Fire dataset.

Reads the tables written by pipeline/global-merge.ts (DATASET_DIR, default
dataset-build/) and writes a self-describing release folder:

  netcdf/   CF-1.8 NetCDF: monthly and annual 1° harmonized fire-days with 90% intervals
  cog/      Cloud-Optimized GeoTIFF per year (annual harmonized fire-days, EPSG:4326)
  tables/   country/world monthly + annual CSV (fire-days, intervals, FRE, CO2, CO, PM2.5)
  model/    harmonization model, blind validation, MODIS detection curves, orbit drift
  stac/     STAC 1.0 catalog, collection and one item per year
  README.md, ATBD.md, CITATION.cff, LICENSE.txt, datapackage.json, quickstart.ipynb

  python pipeline/export_dataset.py [src_dir] [out_dir] [version]
"""
import csv
import json
import os
import shutil
import sys
from datetime import datetime, timezone

import numpy as np
import rasterio
import xarray as xr
from rasterio.transform import from_origin

SRC = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DATASET_DIR", "dataset-build")
OUT = sys.argv[2] if len(sys.argv) > 2 else "dataset-out/firecal-harmonized-active-fire"
VERSION = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("DATASET_VERSION", "1.0.0")
REPO = os.environ.get("GITHUB_REPOSITORY", "sagoresarkerbdcse/nasa")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

TITLE = "FireCal Harmonized Active Fire Record (MODIS→VIIRS), 2003–present"
SUMMARY = (
    "Monthly active-fire activity in VIIRS-equivalent fire-days for every country and every 1° cell, "
    "built from NASA FIRMS MODIS Collection 6.1 and VIIRS S-NPP 375 m archives. MODIS-only years are "
    "harmonized to VIIRS units with a season-stratified, hierarchically shrunk transfer and a small-fire "
    "floor, validated blind on held-out overlap years, with 90% intervals. Includes fire radiative energy "
    "and CO2/CO/PM2.5 emission estimates, a MODIS detection-probability model from same-overpass "
    "matchups, and a Terra/Aqua orbit-drift analysis."
)
LICENSE = "CC-BY-4.0"


def write_json(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=1)


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    for d in ["netcdf", "cog", "tables", "model", "stac/items"]:
        os.makedirs(os.path.join(OUT, d), exist_ok=True)

    g = json.load(open(os.path.join(SRC, "grid_1deg_monthly.json")))
    y0, y1 = g["firstYear"], g["lastYear"]
    ny = y1 - y0 + 1
    nt = ny * 12
    ids = np.array(g["ids"], dtype=np.int64)
    vals = np.array(g["values"], dtype=np.float32).reshape(len(ids), nt)
    lo = np.array(g["lo"], dtype=np.float32).reshape(len(ids), nt)
    hi = np.array(g["hi"], dtype=np.float32).reshape(len(ids), nt)
    lo[lo < 0] = np.nan
    hi[hi < 0] = np.nan

    # cell id = (lat + 90) * 360 + (lon + 180), 1° cells, row 0 = 90°S
    iy = ids // 360
    ix = ids % 360
    lat = np.arange(-89.5, 90, 1.0)
    lon = np.arange(-179.5, 180, 1.0)

    def grid(a, fill):
        out = np.full((a.shape[1], 180, 360), fill, dtype=np.float32)
        out[:, iy, ix] = a.T
        return out

    fd = grid(vals, 0.0)
    fd_lo = grid(lo, np.nan)
    fd_hi = grid(hi, np.nan)
    time = np.array([np.datetime64(f"{y0 + i // 12}-{i % 12 + 1:02d}-01") for i in range(nt)], dtype="datetime64[ns]")
    gap_months = {(int(y), int(m)) for y, m, _ in g.get("gapMonths", [])}
    source = np.array([0 if (y0 + i // 12) < 2012 else (2 if (y0 + i // 12, i % 12 + 1) in gap_months else 1) for i in range(nt)], dtype=np.int8)

    attrs = {
        "Conventions": "CF-1.8, ACDD-1.3",
        "title": TITLE,
        "summary": SUMMARY,
        "product_version": VERSION,
        "source": "NASA FIRMS MODIS C6.1 (Terra+Aqua) and VIIRS S-NPP 375 m standard archives, all-countries yearly files",
        "references": f"https://github.com/{REPO} ; ATBD.md in this package",
        "license": LICENSE,
        "date_created": NOW,
        "creator_name": "FireCal AI team (NASA Space Apps Challenge 2026)",
        "institution": "Independent; not affiliated with or endorsed by NASA",
        "acknowledgement": "Uses data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).",
        "geospatial_lat_min": -90.0,
        "geospatial_lat_max": 90.0,
        "geospatial_lon_min": -180.0,
        "geospatial_lon_max": 180.0,
        "time_coverage_start": f"{y0}-01-01",
        "time_coverage_end": f"{y1}-12-31",
    }
    var_attrs = {
        "units": "1",
        "long_name": "harmonized active-fire days (VIIRS-equivalent unique 0.01° cell-days with nominal/high-confidence detections)",
        "comment": "VIIRS S-NPP observed from 2012; MODIS harmonized to VIIRS units before 2012 (see source_flag).",
    }
    ds = xr.Dataset(
        {
            "harmonized_fire_days": (("time", "lat", "lon"), fd, var_attrs),
            "harmonized_fire_days_lo90": (("time", "lat", "lon"), fd_lo, {"units": "1", "long_name": "5th percentile of the harmonized value (MODIS-harmonized and VIIRS gap-adjusted months)"}),
            "harmonized_fire_days_hi90": (("time", "lat", "lon"), fd_hi, {"units": "1", "long_name": "95th percentile of the harmonized value (MODIS-harmonized and VIIRS gap-adjusted months)"}),
            "source_flag": (("time",), source, {"long_name": "data source", "flag_values": np.array([0, 1, 2], dtype=np.int8), "flag_meanings": "modis_harmonized viirs_observed viirs_gap_adjusted"}),
        },
        coords={
            "time": ("time", time, {"standard_name": "time", "long_name": "first day of month"}),
            "lat": ("lat", lat, {"standard_name": "latitude", "units": "degrees_north", "long_name": "cell centre latitude"}),
            "lon": ("lon", lon, {"standard_name": "longitude", "units": "degrees_east", "long_name": "cell centre longitude"}),
        },
        attrs=attrs,
    )
    enc = {v: {"zlib": True, "complevel": 5} for v in ["harmonized_fire_days", "harmonized_fire_days_lo90", "harmonized_fire_days_hi90"]}
    monthly_nc = f"netcdf/firecal_fire_days_1deg_monthly_{y0}_{y1}.nc"
    ds.to_netcdf(os.path.join(OUT, monthly_nc), encoding=enc)

    annual = ds["harmonized_fire_days"].resample(time="YS").sum()
    ann_ds = xr.Dataset({"harmonized_fire_days": annual.assign_attrs(var_attrs)}, attrs={**attrs, "title": TITLE + " — annual totals"})
    annual_nc = f"netcdf/firecal_fire_days_1deg_annual_{y0}_{y1}.nc"
    ann_ds.to_netcdf(os.path.join(OUT, annual_nc), encoding={"harmonized_fire_days": {"zlib": True, "complevel": 5}})

    # COG per year (north-up: flip rows)
    transform = from_origin(-180, 90, 1, 1)
    items = []
    for k in range(ny):
        year = y0 + k
        arr = annual.isel(time=k).values[::-1, :].astype(np.float32)
        name = f"cog/firecal_fire_days_1deg_{year}.tif"
        with rasterio.open(
            os.path.join(OUT, name),
            "w",
            driver="COG",
            width=360,
            height=180,
            count=1,
            dtype="float32",
            crs="EPSG:4326",
            transform=transform,
            compress="deflate",
            nodata=None,
        ) as dst:
            dst.write(arr, 1)
            dst.update_tags(year=str(year), units="fire-days", source="viirs_observed" if year >= 2012 else "modis_harmonized", product_version=VERSION)
        items.append((year, name))

    # Tables and model files
    for f in ["country_monthly.csv", "country_annual.csv", "grid_1deg_annual.csv"]:
        if os.path.exists(os.path.join(SRC, f)):
            shutil.copy(os.path.join(SRC, f), os.path.join(OUT, "tables", f))
    for f in ["harmonization_model.json", "validation.csv", "modis_detection_probability.csv", "orbit_drift.csv"]:
        if os.path.exists(os.path.join(SRC, f)):
            shutil.copy(os.path.join(SRC, f), os.path.join(OUT, "model", f))

    # STAC
    collection = {
        "type": "Collection",
        "stac_version": "1.0.0",
        "id": "firecal-harmonized-active-fire",
        "title": TITLE,
        "description": SUMMARY,
        "license": LICENSE,
        "extent": {"spatial": {"bbox": [[-180, -90, 180, 90]]}, "temporal": {"interval": [[f"{y0}-01-01T00:00:00Z", f"{y1}-12-31T23:59:59Z"]]}},
        "providers": [
            {"name": "NASA FIRMS / LANCE", "roles": ["producer"], "url": "https://www.earthdata.nasa.gov/data/tools/firms"},
            {"name": "FireCal AI team", "roles": ["processor", "host"], "url": f"https://github.com/{REPO}"},
        ],
        "links": [{"rel": "root", "href": "../catalog.json"}, {"rel": "parent", "href": "../catalog.json"}]
        + [{"rel": "item", "href": f"items/{y}.json"} for y, _ in items],
        "assets": {
            "monthly_netcdf": {"href": f"../{monthly_nc}", "type": "application/x-netcdf", "roles": ["data"], "title": "Monthly 1° harmonized fire-days with 90% intervals"},
            "annual_netcdf": {"href": f"../{annual_nc}", "type": "application/x-netcdf", "roles": ["data"]},
            "country_annual": {"href": "../tables/country_annual.csv", "type": "text/csv", "roles": ["data"]},
            "atbd": {"href": "../ATBD.md", "type": "text/markdown", "roles": ["metadata"]},
        },
    }
    write_json(os.path.join(OUT, "stac", "collection.json"), collection)
    for year, name in items:
        write_json(
            os.path.join(OUT, "stac", "items", f"{year}.json"),
            {
                "type": "Feature",
                "stac_version": "1.0.0",
                "id": f"firecal-fire-days-{year}",
                "collection": "firecal-harmonized-active-fire",
                "geometry": {"type": "Polygon", "coordinates": [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]]},
                "bbox": [-180, -90, 180, 90],
                "properties": {"start_datetime": f"{year}-01-01T00:00:00Z", "end_datetime": f"{year}-12-31T23:59:59Z", "datetime": None, "firecal:source": "viirs_observed" if year >= 2012 else "modis_harmonized"},
                "assets": {"data": {"href": f"../../{name}", "type": "image/tiff; application=geotiff; profile=cloud-optimized", "roles": ["data"]}},
                "links": [{"rel": "collection", "href": "../collection.json"}, {"rel": "root", "href": "../../catalog.json"}],
            },
        )
    write_json(
        os.path.join(OUT, "catalog.json"),
        {"type": "Catalog", "stac_version": "1.0.0", "id": "firecal", "description": TITLE, "links": [{"rel": "root", "href": "./catalog.json"}, {"rel": "child", "href": "./stac/collection.json"}]},
    )

    # Docs, citation, license, Frictionless datapackage
    for src, dst in [("docs/DATASET.md", "README.md"), ("docs/ATBD.md", "ATBD.md"), ("CITATION.cff", "CITATION.cff"), ("docs/quickstart.ipynb", "quickstart.ipynb")]:
        p = os.path.join(ROOT, src)
        if os.path.exists(p):
            text = open(p).read().replace("{{VERSION}}", VERSION).replace("{{YEARS}}", f"{y0}–{y1}").replace("{{DATE}}", NOW[:10])
            if dst == "CITATION.cff":
                import re

                text = re.sub(r'^version: ".*"$', f'version: "{VERSION}"', text, flags=re.M)
                text = re.sub(r'^date-released: ".*"$', f'date-released: "{NOW[:10]}"', text, flags=re.M)
            open(os.path.join(OUT, dst), "w").write(text)
    open(os.path.join(OUT, "LICENSE.txt"), "w").write(
        "Creative Commons Attribution 4.0 International (CC BY 4.0)\nhttps://creativecommons.org/licenses/by/4.0/\n\n"
        "You may share and adapt this dataset for any purpose, provided you give appropriate credit (see CITATION.cff) "
        "and acknowledge NASA FIRMS as the source of the underlying detections.\n"
    )

    def csv_schema(path):
        with open(path) as f:
            header = next(csv.reader(f))
        return {"fields": [{"name": h, "type": "string" if h in ("country", "source", "curve", "satellite", "pass", "method", "train_years", "test_years") else "number"} for h in header]}

    resources = []
    for folder in ["tables", "model"]:
        for f in sorted(os.listdir(os.path.join(OUT, folder))):
            path = f"{folder}/{f}"
            r = {"name": os.path.splitext(f)[0].replace("_", "-"), "path": path}
            if f.endswith(".csv"):
                r.update({"format": "csv", "mediatype": "text/csv", "schema": csv_schema(os.path.join(OUT, path))})
            resources.append(r)
    write_json(
        os.path.join(OUT, "datapackage.json"),
        {
            "name": "firecal-harmonized-active-fire",
            "title": TITLE,
            "description": SUMMARY,
            "version": VERSION,
            "licenses": [{"name": LICENSE, "path": "https://creativecommons.org/licenses/by/4.0/"}],
            "sources": [{"title": "NASA FIRMS", "path": "https://www.earthdata.nasa.gov/data/tools/firms"}],
            "created": NOW,
            "resources": resources,
        },
    )
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    print(f"dataset {VERSION}: {OUT} ({size / 1e6:.1f} MB), {ny} years, {len(ids)} cells")


if __name__ == "__main__":
    main()
