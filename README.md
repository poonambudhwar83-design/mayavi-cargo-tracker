# MAYAVI CARGO — Live Flight Tracker

A Next.js MAWB tracker for photo/PDF extraction and live air-cargo tracking.

## Current workflow
- Upload one image, several images, or a PDF, or enter a MAWB manually.
- OCR/text extraction finds one or many 11-digit MAWB numbers.
- The first 3 digits identify the airline.
- Mayavi opens the mapped official airline cargo tracker, fills the MAWB, and reads the result when the site permits server-side access.
- Primary live fields: Origin, Destination, Estimated/Actual Arrival Date, Arrival Time and Status.
- Extra fields when available: Airline, Flight number, Bags/Pieces and Weight.
- Editable Client Name column for every shipment.
- Mayavi calculates the pre-arrival mail time from the current arrival time.

## Tracking policy
Official airline cargo websites are the primary source. Mayavi does not invent ETA, origin, destination, weight, bags or flight number. If a carrier blocks automation with CAPTCHA/anti-bot/login controls, the tracker reports that technical stop instead of showing fake data.

## Non-Vercel deployment
This branch is designed to be developed from GitHub in Cursor or another IDE and can be run as a normal Node/Docker service. A Dockerfile is included, so the same repository can be deployed to a Docker-capable host without depending on Vercel.

Local development:
```bash
npm install
npm run dev
```

Production:
```bash
npm install
npm run build
npm start
```

Docker:
```bash
docker build -t mayavi-cargo .
docker run -p 3000:3000 mayavi-cargo
```

## Browser persistence
Shipment rows are currently stored in browser localStorage. Tracking results are live, but the saved dashboard list is device/browser-specific until a shared database is added.
