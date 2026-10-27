/** Original decorative artwork. All text remains live HTML. See public/art/README.md. */
export const PAPER_ASSETS = {
  surface: { src: "/art/paper/surface.webp", width: 1600, height: 1000 },
  back: { src: "/art/paper/envelope-back.webp", width: 1600, height: 1000 },
  pocket: { src: "/art/paper/pocket.webp", width: 1600, height: 1000 },
  flapFront: { src: "/art/paper/flap-front.webp", width: 1600, height: 1000 },
  flapBack: { src: "/art/paper/flap-back.webp", width: 1600, height: 1000 },
  letter: { src: "/art/paper/letter.webp", width: 1400, height: 900 },
  seal: { src: "/art/paper/wax-seal.webp", width: 1600, height: 1000 },
  sprig: { src: "/art/paper/sprig.webp", width: 800, height: 1200 },
  edge: { src: "/art/paper/edge.webp", width: 1600, height: 240 },
} as const;

/** These files alone count toward the 900 KiB cold-opening artwork budget. */
export const OPENING_ASSET_KEYS = ["surface", "back", "pocket", "flapFront", "flapBack", "letter", "seal", "sprig"] as const;
