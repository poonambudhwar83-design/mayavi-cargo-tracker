# MAYAVI CARGO Tracker

A deployable Next.js tracker for MAWB document extraction and Track123 air-cargo tracking.

## What is real in this build
- Manual shipment entry and browser persistence.
- PDF text extraction using PDF.js.
- OCR for images/scanned first PDF page using Tesseract.js.
- MAWB / bags / weight / airport-route extraction from document text.
- Server-side Track123 aviation register/query calls (API key never exposed to browser).
- Arrival date/time mapping when Track123 returns an ETA/arrival timestamp.
- Automatic `Mail Due` = arrival time minus 6 hours.
- Clear indicator when the Track123 key is missing; the UI does not fabricate live results.

## Vercel setup
1. Upload the extracted project files to the `mayavi-cargo-tracker` GitHub repository.
2. Connect that repository to the Vercel `mayavi-cargo-tracker` project.
3. In Vercel: Settings -> Environment Variables, add:
   `TRACK123_API_KEY` = your Track123 API key
4. Apply it to Production, Preview and Development.
5. Redeploy.

## Important Track123 note
Air-cargo registration can consume substantially more Track123 quota than parcel tracking. Track123 documentation currently states 100 quota units per registered air-freight tracking number. The tracker registers before querying so a new MAWB can begin tracking; if it already exists, it still proceeds to query.

## Security
Never put the Track123 key in `NEXT_PUBLIC_*` variables or browser JavaScript.
