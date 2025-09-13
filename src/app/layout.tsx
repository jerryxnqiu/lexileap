import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LexiLeap - Learn New Words with Fun Quizzes",
  description: "A kid-friendly vocabulary learning app with fun quizzes and safe email sign-in",
  icons: {
    icon: [
      { url: '/LexiLeap-logo.png', sizes: '32x32', type: 'image/png' },
      { url: '/LexiLeap-logo.png', sizes: '16x16', type: 'image/png' }
    ],
    shortcut: '/LexiLeap-logo.png',
    apple: '/LexiLeap-logo.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}>
        <div className="flex-1 flex flex-col">
          {children}
        </div>
        <footer className="sticky bottom-0 z-50 border-t bg-white/95 backdrop-blur-sm text-xs text-gray-600">
          <div className="container mx-auto px-4 py-4 space-y-1">
            <p>
              WordNet® 3.0 Copyright © 2006 Princeton University. All rights reserved.
            </p>
            <p>
              Provided &quot;AS IS&quot; without warranties. The name &quot;Princeton University&quot; may not be used in advertising or publicity pertaining to distribution of the software and/or database.
            </p>
            <p>
              See the full license: <a className="underline" href="https://wordnet.princeton.edu/license-and-commercial-use" target="_blank" rel="noopener noreferrer">License and Commercial Use of WordNet</a>.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
