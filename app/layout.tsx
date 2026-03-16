import "./globals.css"
import React from "react"

export const metadata = {
  title: "AI Physio BioMech",
  description: "AI powered physiotherapy engine"
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
