"""
Upload the dataset zip to Zenodo as a DRAFT (review it on zenodo.org, then press Publish
to mint the DOI). Uses the Zenodo REST API with a personal access token.

  ZENODO_TOKEN=... python pipeline/publish_zenodo.py <zip> <version>

Environment:
  ZENODO_TOKEN        personal access token with deposit:write (and deposit:actions to publish)
  ZENODO_SANDBOX=true use sandbox.zenodo.org for a dry run (separate account and token)
  ZENODO_RECORD_ID    id of an earlier published record → upload as a NEW VERSION of it
  ZENODO_PUBLISH=true publish immediately (irreversible; default: leave as draft)
"""
import json
import os
import sys
import urllib.request

zip_path = sys.argv[1]
version = sys.argv[2] if len(sys.argv) > 2 else "1.0.0"
token = os.environ.get("ZENODO_TOKEN")
if not token:
    sys.exit("ZENODO_TOKEN is not set (add it as a repository secret).")
base = "https://sandbox.zenodo.org/api" if os.environ.get("ZENODO_SANDBOX", "").lower() == "true" else "https://zenodo.org/api"
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def call(method, url, body=None, raw=None, ctype="application/json"):
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(f"{url}{sep}access_token={token}", method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", ctype)
    if raw is not None:
        data = raw
        req.add_header("Content-Type", "application/octet-stream")
    with urllib.request.urlopen(req, data=data, timeout=600) as r:
        text = r.read().decode() or "{}"
        return json.loads(text)


meta = json.load(open(os.path.join(root, ".zenodo.json")))
meta["version"] = version
meta.setdefault("upload_type", "dataset")

record = os.environ.get("ZENODO_RECORD_ID")
if record:
    nv = call("POST", f"{base}/deposit/depositions/{record}/actions/newversion")
    draft = call("GET", nv["links"]["latest_draft"])
    # drop files inherited from the previous version
    for f in draft.get("files", []):
        call("DELETE", f"{base}/deposit/depositions/{draft['id']}/files/{f['id']}")
else:
    draft = call("POST", f"{base}/deposit/depositions", body={})

bucket = draft["links"]["bucket"]
name = os.path.basename(zip_path)
with open(zip_path, "rb") as f:
    call("PUT", f"{bucket}/{name}", raw=f.read())
call("PUT", f"{base}/deposit/depositions/{draft['id']}", body={"metadata": meta})
print(f"Draft ready: {draft['links'].get('html', '')}")

if os.environ.get("ZENODO_PUBLISH", "").lower() == "true":
    pub = call("POST", f"{base}/deposit/depositions/{draft['id']}/actions/publish")
    print(f"Published. DOI: {pub.get('doi')}  {pub['links'].get('record_html', '')}")
else:
    print("Left as a draft: open it on Zenodo, check authors and description, then press Publish to mint the DOI.")
