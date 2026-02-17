import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Noema",
  description: "LLM FAQ + Notebook learning platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var mode = localStorage.getItem("noema-theme");
                  if (mode === "dark" || mode === "light") {
                    document.documentElement.setAttribute("data-theme", mode);
                  }
                } catch (_) {}
              })();
            `
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
        <ThemeToggle />
      </body>
    </html>
  );
}
