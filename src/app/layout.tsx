import type { Metadata } from "next";
import { Cormorant_Garamond, Inter, DM_Serif_Display } from "next/font/google";
import "./globals.css";
import StoreHydrator from "@/components/StoreHydrator";
import RotateOverlay from "@/components/RotateOverlay";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const numerals = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-numerals",
});

export const metadata: Metadata = {
  title: "Your Internet Radio Dial",
  description:
    "Tune the world's internet radio stations on a beautiful antique console.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${numerals.variable}`}>
      <body className="font-sans text-ivory-dial antialiased">
        <StoreHydrator>{children}</StoreHydrator>
        <RotateOverlay />
      </body>
    </html>
  );
}
