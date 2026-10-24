# Company logo sources

These 14 PNGs seed the shared `company_logos` library used by jobs and PYQ. `sources.json` records each upstream asset and its source page. Logos identify the corresponding companies; inclusion does not imply affiliation or endorsement.

Thirteen icons are from [Simple Icons](https://github.com/simple-icons/simple-icons), distributed under [CC0-1.0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md). Brand rights remain with the respective owners.

The Amazon icon is from [Font Awesome Free](https://github.com/FortAwesome/Font-Awesome/blob/7.x/svgs/brands/amazon.svg), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The icon was rasterized, coloured dark grey and padded for display.

To recreate the PNGs, run `node scripts/fetch-company-logos.mjs` (requires network access and Sharp). To add them to the configured database/private R2 bucket, run `node scripts/seed-company-logos.mjs` after migration 024. The seed reuses matching image hashes and does not overwrite existing content. Company guides are drafts until verified hiring details, papers and practice questions are added and published by Platform Admin.

For a demonstration catalogue, `node scripts/create-company-pyq-content.mjs` prepares the 14 clearly labelled mock guides, and `python3 scripts/create-company-pyq-pdfs.py` builds their model PDFs with answer guides. After building the API, `node scripts/publish-company-pyq-mocks.mjs` explicitly publishes those 14 seeded entries (including archived ones), preserving their logo IDs. This command replaces their training text with mock material; it does not represent the companies' actual hiring procedures or authentic previous-year papers. It leaves other company guides, jobs and access policies unchanged.
