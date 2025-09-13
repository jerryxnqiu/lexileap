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
    icon: '/LexiLeap-logo.png',
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
        <footer className="sticky bottom-0 z-50 border-t bg-white backdrop-blur-sm text-xs text-gray-600">
          <div className="container mx-auto px-4 py-4">
            <p>
              This website makes use of the WordNet® lexical database.
              <br />
              WordNet® 3.0 Copyright © 2006 by Princeton University. All rights reserved.
              <br />
              THIS SOFTWARE AND DATABASE IS PROVIDED &quot;AS IS&quot; AND PRINCETON UNIVERSITY MAKES NO 
              REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED.
              <br />
              The name &quot;Princeton University&quot; may not be used in advertising or publicity 
              pertaining to distribution of the software and/or database.
              <br />
              For full license details, see 
              <a className="underline" href="https://wordnet.princeton.edu/license-and-commercial-use" target="_blank" rel="noopener noreferrer"> WordNet License</a>.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
