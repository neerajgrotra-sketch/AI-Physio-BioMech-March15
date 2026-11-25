// ============================================================
// components/brand/brand.tsx — Rehably look, shared
// ============================================================
// The colours, fonts and logo of the landing page (app/page.tsx),
// for the signed-in app (login, admin, access pages), so the
// product looks the same before and after logging in.
// The fonts are loaded once in app/layout.tsx.
// ============================================================

import React from "react";

export const BRAND = {
  violet: "#6C63FF",
  blue: "#4A90D9",
  teal: "#00C2C7",
  grad: "linear-gradient(135deg, #6C63FF 0%, #4A90D9 55%, #00C2C7 100%)",
  ink: "#0F1117",     // headings, main text
  ink2: "#3D4250",    // body text
  ink3: "#717585",    // muted text
  ink4: "#A8ABBE",    // faint text
  border: "#E4E6EF",
  off: "#F8F9FC",     // page background
  white: "#FFFFFF",
  shadow: "0 1px 3px rgba(15,17,23,0.04), 0 4px 16px rgba(15,17,23,0.05)",
  glow: "0 3px 20px rgba(108,99,255,.32)",
  fontBody: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontHead: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
} as const;

/** Gradient bolt mark plus the "Rehably" wordmark, as on the landing page. */
export function BrandLogo({ size = 32, href = "/" }: { size?: number; href?: string }) {
  return (
    <a href={href} style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", flexShrink: 0 }}>
      <span style={{
        width: size, height: size, borderRadius: size / 4, background: BRAND.grad,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 1px 10px rgba(108,99,255,.28)", flexShrink: 0,
      }}>
        <svg width={size / 2} height={size / 2} viewBox="0 0 24 24" fill="white" aria-hidden="true">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </span>
      <span style={{ fontFamily: BRAND.fontHead, fontSize: size * 0.53, fontWeight: 700, letterSpacing: "-.2px", color: BRAND.ink }}>
        <span style={{ background: BRAND.grad, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>Reha</span>bly
      </span>
    </a>
  );
}
