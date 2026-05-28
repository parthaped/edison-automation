# Generating image file lists from edisondigital.rutgers.edu

Use this guide to assemble the per-image CSV used by the Edison automation
upload pipeline. The CSV maps each image filename to its parent Doc ID, Folder
ID, and identifying metadata. Run it once per item set before uploading the
images into the transcription workbench.

## 1. Export the Omeka CSV

1. In the Omeka admin, open the item set that contains the items you need.
2. Switch to **Edit** mode to get links to media files in an item set.
3. Open **Advanced Search** and set the filter to `"In item set" [Item Set ID]`.
4. Run the search. At the bottom of the search-result screen there will be a
   link to download the CSV.
5. Download and save the CSV locally; it should include the `o:media/file`
   column (multiple values separated by `|`).

## 2. Split the multi-valued media column with Gemini

Open Gemini and upload the CSV from step 1. Use the following prompt verbatim:

> I have uploaded a CSV file. Inside it, one of the columns `o:media/file` has
> multiple values separated by a `|` character. Please produce a new
> downloadable CSV with one row per value in the `o:media/file` column. Keep
> only the following columns in this order:
>
> 1. `o:id`
> 2. `dcterms:identifier`
> 3. `dcterms:title`
> 4. `dcterms:date`
> 5. `dcterms:source`
> 6. `o:media/file`

Download the resulting CSV. Each row now represents a single image file and is
ready to drive a batched upload.

## 3. Upload images into the workbench

1. Pick a Folder ID (e.g. `D9032-F`) and a Doc ID prefix.
2. Rename each image so its filename matches the Doc ID convention
   (`D9032-00001`, `D9032-00002`, ...).
3. Drag the renamed images into the Edison automation upload form. Pick the
   document type:
   - **Standard document** for letters, telegrams, and similar correspondence.
   - **Project notebook** for laboratory project logs.
4. Confirm transcription and metadata extraction in the results panel.

The transcriptions follow the canonical formatting (`Letterhead, dateline,
salutation, body, closing, signature`, with handwritten marginal notes in
italicized angle brackets), and the metadata grid mirrors the indexing prompt
(document type, date, authors, recipients, mentioned names, subjects, image
names, Folder ID, Doc ID).
