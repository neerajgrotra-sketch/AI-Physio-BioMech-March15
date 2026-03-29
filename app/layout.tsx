import "./globals.css";
import React from "react";
import { PrescriptionLibraryProvider } from "@/components/providers/PrescriptionLibraryProvider";
import { SessionLibraryProvider } from "@/components/providers/SessionLibraryProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";

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
        <AuthProvider>
          <PrescriptionLibraryProvider>
            <SessionLibraryProvider>{children}</SessionLibraryProvider>
          </PrescriptionLibraryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
