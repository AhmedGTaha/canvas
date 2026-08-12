export const PREVIEW_IFRAME_SANDBOX = "allow-scripts" as const;

export function previewSecurityHeaders(nonce: string, canvasOrigin: string) {
  const origin = new URL(canvasOrigin).origin;
  return {
    "Content-Security-Policy": [
      "default-src 'none'", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`, `img-src ${origin} data:`,
      "font-src 'none'", "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", `frame-ancestors ${origin}`,
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Resource-Policy": "same-site",
    "Cross-Origin-Embedder-Policy": "credentialless",
  } as const;
}
