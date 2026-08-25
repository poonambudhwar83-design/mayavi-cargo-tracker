# MAYAVI CARGO — Live Flight Tracker

Mayavi is a Next.js MAWB tracker for photo/PDF extraction and live air-cargo tracking.

## Current workflow
- Upload one image, several images, or a PDF, or enter a MAWB manually.
- OCR/text extraction finds one or many 11-digit MAWB numbers.
- The first three MAWB digits identify the airline.
- Mayavi opens that airline's official cargo tracking website with a headless Chrome browser.
- It fills the MAWB into the official tracking form and reads machine-readable shipment data when the airline permits it.
- Primary live fields: Origin, Destination, Estimated/Actual Arrival Date, Arrival Time and Status.
- Extra fields when available: Airline, Flight number, Bags/Pieces and Weight.
- Editable Client Name remains on each shipment row.
- Mayavi calculates the pre-arrival mail time from the current arrival time.

## Tracking policy
- TrackJet is not used.
- No paid tracking API is required by the current official-airline engine.
- If an airline shows CAPTCHA, a login wall, or blocks automation, Mayavi reports the exact technical stop instead of inventing shipment data.
- ETA, origin, destination, weight, bags and flight number are only populated when they are actually read from the airline response.

## Runtime
The project is Docker-ready and is not tied to Vercel. The Docker image installs Chromium and sets `CHROME_EXECUTABLE_PATH=/usr/bin/chromium`, which avoids the missing shared-library problem seen with minimal serverless Chromium environments.

Run locally with Docker:

```bash
docker build -t mayavi-cargo-tracker .
docker run --rm -p 3000:3000 mayavi-cargo-tracker
```

Health check: `GET /api/health`
Tracking API: `POST /api/track` with JSON `{ "mawb": "157-12345678" }`

## GitHub + Cursor + Claude workflow
GitHub is the source of truth. Open this repository in Cursor, create a branch for changes, use Cursor/Claude to improve individual airline adapters, then push back to GitHub. GitHub Actions runs a Next.js build on pushes and pull requests.

## Browser persistence
Shipment rows are currently stored in browser localStorage. Tracking results are live, but the saved dashboard list is device/browser-specific until a shared database is added.
