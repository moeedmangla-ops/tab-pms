import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TAB Consultants — Practice Management",
  description: "Where Strategy Drives Measurable Growth",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
