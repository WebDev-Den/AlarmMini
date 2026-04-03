import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AlarmMini Installer",
  description: "Вибір релізу, Web Serial і сервісна сторінка для AlarmMini.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
