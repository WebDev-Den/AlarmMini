import "./globals.css";
import type { Metadata } from "next";
import { LanguageProvider } from "./language-provider";
import { translateText } from "./lang";

export const metadata: Metadata = {
  title: "AlarmMini Installer",
  description: translateText("Проший ESP32-C3 або ESP8266 через USB. Просте оновлення AlarmMini зі збереженням і перевіркою налаштувань."),
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uk" suppressHydrationWarning>
      <body><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}
