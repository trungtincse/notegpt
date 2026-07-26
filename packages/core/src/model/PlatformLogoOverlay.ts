/** Fraction of a thumbnail's shorter side the overlaid logo badge is sized to, clamped so it
 * reads clearly on both a small and a huge thumbnail. */
const LOGO_SIZE_RATIO = 0.32;
const LOGO_MIN_SIZE = 32;
const LOGO_MAX_SIZE = 96;

// The recognizable red rounded-rect + white triangle "play button" glyph YouTube's own brand
// mark uses.
export const YOUTUBE_LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="2" y="18" width="96" height="64" rx="16" fill="#FF0000"/>
  <polygon points="40,34 40,66 70,50" fill="#FFFFFF"/>
</svg>`;

function noteGlyph(fill: string): string {
  return `<g fill="${fill}">
    <ellipse cx="35" cy="70" rx="16" ry="12" transform="rotate(-15 35 70)"/>
    <rect x="48" y="20" width="8" height="52"/>
    <path d="M56 20 C 72 22 80 30 80 42 L 72 42 C 72 34 66 28 56 27 Z"/>
  </g>`;
}

// A simplified stand-in for TikTok's stylized musical-note mark — a black badge with a white
// note glyph, plus cyan/magenta copies offset behind it approximating the brand's signature
// chromatic-shift look.
export const TIKTOK_LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="18" fill="#000000"/>
  <g transform="translate(-3,-2)">${noteGlyph("#25F4EE")}</g>
  <g transform="translate(3,2)">${noteGlyph("#FE2C55")}</g>
  ${noteGlyph("#FFFFFF")}
</svg>`;

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Builds a small square "image" element carrying `logoSvg`, centered over `host`'s box — a
 * sibling layered on top rather than something baked into the thumbnail bitmap itself.
 * Chromium's printToPDF renders plain HTML/CSS, so two overlapping image elements composite
 * correctly with no canvas/pixel access needed (which also sidesteps the cross-origin
 * thumbnail image being unreadable back from a canvas anyway). Only the fields Excalidraw
 * itself doesn't fill in via its own `initialData` normalization need to be set here — see
 * ensureMarkdownElements's sibling elements for the same sparse-object pattern. */
export function buildLogoOverlayElement(
  host: RectLike,
  logoSvg: string,
  fileId: string
): { element: Record<string, unknown>; file: Record<string, unknown> } {
  const size = Math.min(Math.max(Math.min(host.width, host.height) * LOGO_SIZE_RATIO, LOGO_MIN_SIZE), LOGO_MAX_SIZE);
  return {
    file: { id: fileId, mimeType: "image/svg+xml", dataURL: svgToDataUrl(logoSvg), created: 0 },
    element: {
      id: `${fileId}:overlay`,
      type: "image",
      x: host.x + host.width / 2 - size / 2,
      y: host.y + host.height / 2 - size / 2,
      width: size,
      height: size,
      fileId,
      locked: true,
    },
  };
}
