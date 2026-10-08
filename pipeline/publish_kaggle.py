"""
Create or update the dataset on Kaggle (needs KAGGLE_USERNAME and KAGGLE_KEY).

  python pipeline/publish_kaggle.py <dataset-folder> <version>

The first run creates the dataset (public); later runs add a new version.
"""
import json
import os
import subprocess
import sys

folder = sys.argv[1]
version = sys.argv[2] if len(sys.argv) > 2 else "1.0.0"
user = os.environ.get("KAGGLE_USERNAME")
if not user or not os.environ.get("KAGGLE_KEY"):
    sys.exit("KAGGLE_USERNAME / KAGGLE_KEY are not set (add them as repository secrets).")
slug = os.environ.get("KAGGLE_DATASET_SLUG", "firecal-harmonized-active-fire")

meta = {
    "title": "FireCal Harmonized Active Fire 2003-present",
    "subtitle": "MODIS to VIIRS harmonized NASA FIRMS fire record with uncertainty",
    "id": f"{user}/{slug}",
    "licenses": [{"name": "CC-BY-4.0"}],
    "keywords": ["earth and nature", "environment", "climate", "geospatial analysis", "time series analysis"],
    "description": open(os.path.join(folder, "README.md")).read() if os.path.exists(os.path.join(folder, "README.md")) else "",
}
with open(os.path.join(folder, "dataset-metadata.json"), "w") as f:
    json.dump(meta, f, indent=1)


def run(args):
    print("$", " ".join(args))
    return subprocess.run(args, capture_output=True, text=True)


status = run(["kaggle", "datasets", "status", meta["id"]])
if status.returncode == 0 and "ready" in (status.stdout + status.stderr).lower():
    r = run(["kaggle", "datasets", "version", "-p", folder, "-m", f"FireCal dataset v{version}", "--dir-mode", "zip"])
else:
    r = run(["kaggle", "datasets", "create", "-p", folder, "--dir-mode", "zip", "--public"])
print(r.stdout, r.stderr)
if r.returncode != 0:
    sys.exit(r.returncode)
print(f"https://www.kaggle.com/datasets/{meta['id']}")
