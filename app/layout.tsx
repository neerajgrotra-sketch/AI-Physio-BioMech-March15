import "./globals.css";
import React from "react";
import { PrescriptionLibraryProvider } from "@/components/providers/PrescriptionLibraryProvider";
import { SessionLibraryProvider } from "@/components/providers/SessionLibraryProvider";

export const metadata = {
  title: "Rehably",
  description: "Real-time rehabilitation, measured and guided."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* The brand fonts (components/brand/brand.tsx), for every page */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body>
        <PrescriptionLibraryProvider>
          <SessionLibraryProvider>{children}</SessionLibraryProvider>
        </PrescriptionLibraryProvider>
      </body>
    </html>
  );
}
