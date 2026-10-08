# Publishing the FireCal dataset so people can cite it

**Recommendation:** use **Zenodo** for the DOI (the citable, permanent copy) and **Kaggle** for reach (data scientists find and use it there). Point each one to the other and to GitHub. All three can be fed from the same workflow run.

| Where | What it gives you | Citable DOI | Effort |
|---|---|---|---|
| **Zenodo** (CERN) | Permanent archive, a DOI for each version and one for "all versions", indexed by Google Dataset Search, OpenAIRE and DataCite. This is the standard place scientists expect for research datasets. | **Yes** | ~10 min |
| **Kaggle** | Large data-science audience, notebooks running next to the data, usability score. | Not confirmed for datasets. Cite the Zenodo DOI in the description. | ~10 min |
| **GitHub release** | Download for people already on the repo. | No (unless archived by Zenodo) | 0 min |
| Hugging Face Datasets (optional) | ML audience. A DOI can be generated from the dataset's settings. | Yes | ~10 min |

Your project page and Space Apps submission should cite the **Zenodo DOI**.

## Before the first release (5 minutes)

1. **Authors.** Edit `CITATION.cff` and `.zenodo.json`. Replace `FireCal AI team` with each team member's name and, ideally, an [ORCID iD](https://orcid.org/register) (free; scientists use it to credit people).
2. **Check the numbers.** Open `/lab` in the app and read `docs/ATBD.md`.
3. **Pick a version.** Use `1.0.0` for the first release. Later fixes: `1.0.1`. New years or method changes: `1.1.0`.

## A. Build the package (every time)

GitHub → **Actions** → **Build global FIRMS dataset** → **Run workflow**:
* `from_run`: the id of the last successful full run. This re-uses its downloads, so it takes about 5 minutes. Leave it empty to download everything again (about 30 minutes).
* `dataset_version`: e.g. `1.0.0`.

The run uploads an artifact called **firecal-dataset** (a zip) that you can download and inspect. Tick **release** to also attach the zip to a GitHub release.

## B. Zenodo: the DOI (recommended)

1. Create an account at https://zenodo.org. Logging in with GitHub or ORCID is easiest.
2. **Profile → Applications → Personal access tokens → New token.** Give it the scopes `deposit:write` and `deposit:actions`. Copy it.
3. GitHub repo → **Settings → Secrets and variables → Actions**:
   * **New repository secret:** `ZENODO_TOKEN` = the token.
   * Optional: to rehearse first, also create a token on https://sandbox.zenodo.org, store that one as `ZENODO_TOKEN`, and add a **variable** `ZENODO_SANDBOX` = `true`. Remove both when you're done rehearsing.
4. Run the workflow (step A) with **zenodo** ticked. The log prints a link to a **draft**.
5. Open the draft on Zenodo. Check the title, authors, description, licence (CC BY 4.0) and keywords, and that the zip is attached.
6. Press **Publish**. Zenodo shows the **DOI**. Publishing can't be undone. Files can't be changed afterwards, only superseded by a new version.
7. Put the DOI in `CITATION.cff` (`doi:`), the README badge and the app's Lab page.
8. **New versions:** add a repository **variable** `ZENODO_RECORD_ID` = the number in the record URL (`zenodo.org/records/<id>`). The workflow then uploads a new version under the same "all versions" DOI.

Zenodo's own GitHub integration (Settings → GitHub → toggle the repo) archives the **source code** of each GitHub release. It needs a public repository. Use it if you also want a DOI for the software; the dataset itself goes through the upload above.

## C. Kaggle: reach

1. https://www.kaggle.com → profile → **Settings → API → Create New Token**. This downloads `kaggle.json` containing `username` and `key`.
2. GitHub repo → **Settings → Secrets and variables → Actions**: add the secrets `KAGGLE_USERNAME` and `KAGGLE_KEY`.
3. Run the workflow with **kaggle** ticked. The first run creates `kaggle.com/datasets/<username>/firecal-harmonized-active-fire` (public); later runs add versions.
4. On the Kaggle page:
   * Add a cover image (a screenshot of the world map from the app works well).
   * Fill in "Provenance": NASA FIRMS, with this repo and the Zenodo DOI.
   * Add tags.
   * Click **New Notebook** and paste `quickstart.ipynb`, so visitors can run it straight away. This raises the dataset's usability score.
5. In the description, add: **"Please cite: <Zenodo DOI>"**.

You can also do it by hand: download the artifact zip, then upload the unzipped folder at kaggle.com → **Create → New Dataset**.

## D. Make it findable

* Zenodo and Kaggle both publish schema.org metadata, so the dataset shows up in **Google Dataset Search** within days.
* Link the Zenodo DOI in your Space Apps project page, the GitHub README and the app (Data sources panel and Lab page).
* Tell NASA FIRMS users where it is. The FIRMS community and Earthdata forums are good places to share a derived product.

## Licence and attribution

CC BY 4.0: anyone can reuse it with credit. NASA data carries no restrictions, but acknowledge it: *"We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS)."* Don't use NASA logos. State that the project is independent and not endorsed by NASA (already in every file).
