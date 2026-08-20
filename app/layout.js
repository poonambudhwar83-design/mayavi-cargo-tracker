import './globals.css';

export const metadata = {
  title: 'MAYAVI CARGO — Arrival Tracker',
  description: 'MAWB upload, OCR and live air cargo tracking'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
