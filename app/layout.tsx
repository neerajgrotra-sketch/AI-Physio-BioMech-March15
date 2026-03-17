import "./globals.css";
import React from "react";
import { PrescriptionLibraryProvider } from "@/components/providers/PrescriptionLibraryProvider";

export const metadata = {
  title: "AI Physio BioMech",
  description: "AI powered physiotherapy engine"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PrescriptionLibraryProvider>{children}</PrescriptionLibraryProvider>
      </body>
    </html>
  );
}
