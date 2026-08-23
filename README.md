# MAYAVI CARGO — Live Flight Tracker

A deployable Next.js MAWB tracker for photo/PDF extraction and live airline tracking.

## Current workflow
- Upload one image, several images, or a PDF.
- OCR/text extraction finds one or many 11-digit MAWB numbers.
- The first 3 digits identify the airline prefix.
- Mayavi opens that airline's official cargo-tracking website first.
- It enters the MAWB into the airline tracker and reads machine-readable live shipment data.
- Primary live fields: Origin, Estimated Arrival Date, Estimated Arrival Time and Status.
- Extra fields when available: Flight number, Bags/Pieces and Weight.
- Editable Client Name column for every shipment.
- Mail Time is automatically calculated as arrival time minus 5 hours.
- Active shipments auto-refresh every 20 minutes while the dashboard is open.

## Fallback rule
Track123 is not the normal route. It is used only for the individual MAWB whose official airline tracker is technically blocked by CAPTCHA/anti-bot verification, a login wall, an inaccessible tracking form, or a live result that cannot be read by the server browser. Other airlines continue to use their own official websites directly.

If the official airline website itself returns a normal `not found / no shipment record` response, Mayavi shows that airline result and does not send the MAWB to the fallback.

The fallback requires `TRACK123_API_KEY` in Vercel. No API key is required for the official-airline primary route.

## Data integrity
Mayavi does not invent ETA, origin, weight, bags or flight number. If neither the official airline nor the permitted fallback produces readable live data, the dashboard shows the exact technical stage instead.

## Browser persistence
Shipment rows are currently stored in browser localStorage. Tracking results are live, but the saved dashboard list is device/browser-specific until a shared database is added.
