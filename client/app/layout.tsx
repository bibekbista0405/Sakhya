import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/hooks/useAuth";
import { SocketProvider } from "@/hooks/useSocket";
import { CallProvider } from "@/hooks/useCall";
import { NotificationProvider } from "@/hooks/useNotifications";
import { ThemeProvider } from "@/hooks/useTheme";
import { ChatLockProvider } from "@/hooks/useChatLock";
import { CallLayerLazy } from "@/components/calls/CallLayerLazy";

export const metadata: Metadata = {
  title: "Sakhya",
  description: "Simple, fast messaging and calling.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1013" },
  ],
};

// Applies the saved theme before React hydrates, so there's no flash of the
// wrong theme on load.
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('sakhya_theme') || 'system';
    var isDark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full h-full flex flex-col bg-background text-foreground overscroll-none">
        <ThemeProvider>
          <AuthProvider>
            <SocketProvider>
              <NotificationProvider>
                <CallProvider>
                  <ChatLockProvider>
                    {children}
                    <CallLayerLazy />
                  </ChatLockProvider>
                </CallProvider>
              </NotificationProvider>
            </SocketProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
