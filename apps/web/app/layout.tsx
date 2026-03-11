import type { ReactNode } from "react";
import { Heebo } from "next/font/google";
import "./globals.css";
import { getClientConfig } from "../lib/config";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo"
});

export const metadata = {
  title: "ארץ עיר אונליין — משחק קטגוריות מולטיפלייר",
  description: "משחק ארץ עיר מולטיפלייר בזמן אמת עם AI. צור חדר, הזמן חברים, ותתחרו על ניקוד!",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const clientConfig = getClientConfig();

  return (
    <html lang="he" dir="rtl">
      <body className={heebo.variable}>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__APP_CONFIG__ = ${JSON.stringify(clientConfig)};`
          }}
        />
        {children}
      </body>
    </html>
  );
}


