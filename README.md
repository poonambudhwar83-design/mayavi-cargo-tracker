# MAYAVI CARGO — Live Flight Tracker

A deployable Next.js MAWB tracker for photo/PDF extraction and live airline tracking.

## Current workflow
- Upload one image, several images, or a PDF.
- OCR/text extraction finds one or many 11-digit MAWB numbers.
- The first 3 digits identify the airline prefix.
- The server opens TrackJet as the carrier-routing point and follows the matching official-airline handoff.
- Mayavi reads machine-readable airline shipment data without fabricating missing values.
- Primary live fields: Origin, Estimated Arrival Date, Estimated Arrival Time and Status.
- Extra fields when available: Flight number, Bags/Pieces and Weight.
- Editable Client Name column for every shipment.
- Mail Time is automatically calculated as arrival time minus 5 hours.
- Early/Delayed status is flagged when the live arrival moves at least 30 minutes from the first ETA stored by Mayavi.
- Active shipments auto-refresh every 20 minutes while the dashboard is open, and can be refreshed manually at any time.

## Live-data rules
The official-carrier page is treated as the primary source. If a carrier blocks automated access with CAPTCHA or does not expose readable shipment details, Mayavi shows that tracking stage/error instead of inventing ETA, origin, weight or bags.

## Deployment
The production branch is `main`. Connect this GitHub repository to the Vercel Mayavi Cargo project and point the custom domain to that project. The current TrackJet → official carrier browser route does not require the old Track123 API key.

## Browser persistence
Shipment rows are currently stored in browser localStorage. Tracking results are live, but the saved dashboard list is device/browser-specific until a shared database is added.
