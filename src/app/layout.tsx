import type { Metadata, Viewport } from "next";
import { getSiteUrl } from "@/lib/site";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Noema",
    template: "%s | Noema"
  },
  description: "機械学習・LLM・強化学習をノートブック形式で学べるNoemaの学習プラットフォーム。",
  applicationName: "Noema",
  manifest: "/manifest.webmanifest",
  keywords: ["Noema", "機械学習", "深層学習", "LLM", "強化学習", "Python", "ノートブック教材"],
  alternates: {
    canonical: "/"
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Noema",
    title: "Noema",
    description: "機械学習・LLM・強化学習をノートブック形式で学べる学習プラットフォーム。",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Noema"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "Noema",
    description: "機械学習・LLM・強化学習をノートブック形式で学べる学習プラットフォーム。",
    images: ["/opengraph-image"]
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1
    }
  },
  verification: {
    google: "tRTWHvPDaxls1Zos9tIWxOYurEY-oHXiu9xhVpUCpU8"
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Noema"
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  }
};

export const viewport: Viewport = {
  themeColor: "#071225"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
