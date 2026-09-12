import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: "KartelKoin Wallet Checker",
  description: "View your Solana and Ethereum wallet balances and token holdings in one place. Live on-chain.",
  icons: { icon: "/favicon.ico" },
  metadataBase: new URL("https://check.kartelkoin.xyz"),
  other: {
    "msapplication-TileColor": "#111111",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable}`}>
      <body className="antialiased" style={{ fontFamily: "var(--font-geist)" }}>
        {children}
      </body>
    </html>
  );
}
