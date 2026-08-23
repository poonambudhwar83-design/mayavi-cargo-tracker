# MAYAVI CARGO — Live Flight Tracker

A deployable Next.js MAWB tracker for photo/PDF extraction and live air-cargo tracking.

## Current workflow
- Upload one image, several images, or a PDF, or enter a MAWB manually.
- OCR/text extraction finds one or many 11-digit MAWB numbers.
- Mayavi sends each MAWB to the ShipsGo Air API.
- It finds an existing ShipsGo shipment or creates tracking for a new MAWB.
- It reads the shipment details and maps them back into the Mayavi dashboard.
- Primary live fields: Origin, Destination, Estimated/Actual Arrival Date, Arrival Time and Status.
- Extra fields when available: Airline, Flight number, Bags/Pieces, Weight, Volume, transshipments and transit time.
- Editable Client Name column for every shipment.
- Mayavi calculates the pre-arrival mail time from the current arrival time.

## ShipsGo configuration
The backend reads the ShipsGo token only from the Vercel server environment variable `SHIPSGO_API_TOKEN` (or legacy `SHIPSGO_TOKEN`). The token is never stored in browser code or committed to GitHub.

## Data integrity
Mayavi does not invent ETA, origin, destination, weight, bags or flight number. If ShipsGo does not provide a field, Mayavi leaves it blank rather than guessing.

## Browser persistence
Shipment rows are currently stored in browser localStorage. Tracking results are live, but the saved dashboard list is device/browser-specific until a shared database is added.
