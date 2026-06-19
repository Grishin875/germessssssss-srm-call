import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "../lib/auth";
import { ThemeProvider, ANTI_FLASH_SCRIPT } from "../lib/theme";
import { ToastProvider } from "../components/ui/Toast";
import { PwaRegister } from "../components/PwaRegister";
import { I18nProvider } from "../lib/i18n";

export const metadata: Metadata = {
  title: "CRM B3 Производства",
  description: "CRM система управления производством",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Germess" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* Anti-flash: apply theme before React hydrates */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>
          <ThemeProvider>
            <I18nProvider>
              <ToastProvider>
                {children}
                <PwaRegister />
              </ToastProvider>
            </I18nProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
