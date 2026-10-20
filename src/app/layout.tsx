import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ORBITAL — Satellite Mission Control",
  description:
    "Explore Earth orbit with real satellite elements, SGP4 position predictions, and observer pass forecasts. An independent mission-control workspace.",
  applicationName: "ORBITAL",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#080b10" };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
