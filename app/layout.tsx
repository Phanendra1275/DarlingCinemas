import type { Metadata } from "next";
import "./globals.css";
import "./darling.css";

export const metadata: Metadata = {
  title: "Darling Cinemas - Your private cinema",
  description: "A private 3D cinema. Choose a seat, bring a film, and watch together.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
