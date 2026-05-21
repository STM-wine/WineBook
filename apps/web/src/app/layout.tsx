import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WineBook",
  description: "Stem Wine Company ordering dashboard"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
