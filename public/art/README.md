# Invitation art provenance

- `botanical-corner.png`: original decorative watercolor generated with OpenAI's built-in image-generation tool on 2026-10-27. The prompt requested a sparse asymmetric coral/peach rose and sage-leaf spray on true transparency, with no text, monogram, people, architecture, venue claims or vendor reference. No supplied reference image was uploaded. Decorative only; CSS backgrounds carry no content.
- `botanical-corner.webp`: lossless WebP delivery derivative of the PNG, generated with Sharp 0.35.5; 922,356 bytes versus 1,970,368 bytes. Flattened decoded visible pixels compare byte-for-byte equal. The PNG remains the source master.
- `placeholder.svg`: original neutral crop-mark geometry authored for this project. Accompanies explicit localized text; it never stands in for a real photograph.
- The official monogram, main couple photograph, four supporting photos and venue photograph are not supplied. No replacement monogram or fabricated couple/venue image is used. Personal assets must be served through the authorized private-photo workflow, never placed in this public directory.

Full generation prompt: “Use case: stylized-concept. Asset type: original decorative floral corner for a refined Indian wedding invitation website. Paint a single sparse asymmetric botanical spray curving up from the lower left: small coral and soft peach garden roses, a few ivory buds, delicate sage and dusty green leaves on slender stems. Genuine translucent watercolor pigment, feathered edges, airy pale washes, subtle hand-painted detail. Composition: portrait 1024x1536, flowers concentrated in lower left and trailing gently upwards, ample fully transparent negative space on right, no enclosing frame. Actual transparent background. No text, no monogram, no people, no architecture, no gold ornaments, no watermark, no vendor reference. This is decorative botanical art, not a couple or venue image.”


## Original interactive paper pack (2026-10-27)

All nine assets under `paper/` are distinct original raster generations made with OpenAI’s built-in image generation tool. No external screenshot or supplied reference artwork was uploaded, sampled or copied into the production files. The paper, wax and botanical fragments are decorative. They contain no lettering, names, monogram, people, architecture or venue claims. The seal is deliberately unlettered until approved artwork is supplied.

Raw PNG masters and full prompts are retained privately in the task’s ignored `.superpowers/sdd/2026-10-27-wedding-ui-polish/task1-artifacts/masters/` and `prompts.json`. Runtime WebP derivatives were packaged with the existing Sharp 0.35.5 used by Next: explicit crop/resize/transparent-canvas registration, WebP quality 78, alpha quality 100, effort 6. No painted bitmap/SVG substitutes, color replacement, alpha thresholding or algorithmic retouching were used. Native generated alpha and tight contact shadows are retained.

| Runtime file | Canvas | Bytes | Source SHA-256 |
|---|---:|---:|---|
| `paper/surface.webp` | 1600×1000 | 106,418 | `047cfa795b50030e962a8913518e5ec0c399b854dec2c8023d11e74cdf966169` |
| `paper/envelope-back.webp` | 1600×1000 | 133,484 | `33b0a0d07ba16c63726ea2c238859dcbc1876cf4d0812b3403edfc244a0b7b2b` |
| `paper/pocket.webp` | 1600×1000 | 108,430 | `87d85f80563355df57a3e6ea3d2fd857dc6c25016ea6e0977d0d6a8ebb3b22e7` |
| `paper/flap-front.webp` | 1600×1000 | 123,336 | `5d303de47bd6ae12a23b3833af6db50c0053bc314221940c1a2f0e09abaf3a1d` |
| `paper/flap-back.webp` | 1600×1000 | 76,234 | `d8f9c21cdfb7e3c30675a5c2cb828fce31eff8c72daafbbe20669835924334e7` |
| `paper/letter.webp` | 1400×900 | 118,362 | `e36e06fcbb46ad5943336c72930a7cd08b0179bfe6bea4bc10f5c0fa761412e9` |
| `paper/wax-seal.webp` | 1600×1000 | 15,644 | `b638534c9748674ea69550b4f0104b11ca55e1488dda7e5d0e72ad1d9d2abf12` |
| `paper/sprig.webp` | 800×1200 | 178,926 | `2975d7bac312a66ecc5ad8257781dc45b7c2f70e46d5d355c4e02c74c9d22f0f` |
| `paper/edge.webp` | 1600×240 | 68,366 | `75a8c6180db6682da11aa25ea56894cdb9e7f913b1a80053d198e6a008913c8c` |

### Scene registration and transfer

- `envelope-back`, `pocket`, `flap-front`, `flap-back`, and `wax-seal` all share a 1600×1000 canvas. Stack them at identical origin and dimensions. The top-center flap hinge is `(800,0)` (`transform-origin: 50% 0`). Both flap faces occupy the top 650px of that canvas with transparent space beneath.
- The seal’s 300×300 artwork is registered at `(650,410)`, giving its nominal center `(800,560)`. Animate the full registered seal layer around `50% 56%`, or keep that registration when extracting a visual control. It is not a full-canvas visible disc.
- The pocket is a genuine generated V cutout with transparent upper opening; preserve occlusion by drawing the letter before the pocket. The letter uses its own 1400×900 canvas; place it at `(100,50)` in the 1600×1000 envelope before choreography.
- Paper surface: 1600×1000. Botanical sprig: 800×1200; preserve its 2:3 ratio and use sparingly. Deferred edge: 1600×240. All declared dimensions are source canvases, including alpha margins.
- `OPENING_ASSET_KEYS` includes surface, back, pocket, both flap faces, letter, seal and sprig: **860,834 bytes / 840.7 KiB** (limit 900 KiB). The **68,366-byte** edge is below-fold decoration and must load lazily. Masters are never requested by the app.
- Lighting is consistently upper-left, with restrained lower-right contact shadows. Alpha and material alignment were checked composited on ivory at phone and desktop scales, including 2×.

### Typography

`@fontsource/pinyon-script@5.3.0` supplies `files/pinyon-script-latin-400-normal.woff2` (39,044 bytes / 38.1 KiB; limit 60 KiB), licensed SIL OFL 1.1. Copyright 2022 The PinyonScript Project Authors. The package retains its LICENSE. Root layout loads that one Latin face through `next/font/local`, `display: swap`, explicit preload, a metric-adjusted Times New Roman fallback, and the `--font-invitation-script` variable. The body receives only the variable class; invitation classes opt into the script. There is no duplicate CSS font import and no organizer font restyling. Existing Cormorant Garamond and upright Noto Sans Devanagari remain the editorial and Hindi/control faces.

### Native generation prompts

Each asset was generated separately, with true transparency requested for every cutout and an opaque full-bleed surface. The source prompts below are recorded verbatim.

**surface**

Use case: product-mockup. Asset type: original cotton-paper surface texture for a refined interactive wedding invitation. Generate only a full-bleed warm ivory handmade cotton rag paper sheet seen exactly overhead, seamless-looking 1600x1000 landscape crop. Base color #fffaf3 with visible fine random cotton fibers and softly tactile organic grain. Gentle studio light from upper left, subtle natural material variation only, no vignette, no folds, no visible sheet perimeter. Empty unprinted paper. No text, letters, monogram, logo, watermark, flowers, objects, people or architecture. Material craft comparable to macro luxury letterpress stationery, never synthetic embossed noise. Output one flat photographic material texture.

**back**

Use case: product-mockup. Asset type: original single envelope back panel cutout for an interactive layered paper scene. Primary request: one empty warm ivory #fffaf3 cotton-rag envelope rectangular backing panel, 8:5 width-to-height, photographed perfectly straight overhead, edges parallel to canvas. Entire piece visible with small transparent margin, genuinely transparent background outside the rectangular paper. Fine naturally random fibers, delicate deckled cut edges, rich real paper material. Soft consistent studio light from upper left, tiny contact shadow to lower right only. Flat unprinted solid sheet, no flap, no pocket, no folds across center, no decoration. No text, monograms, logos, people, buildings, flowers, marks or watermark. This will fill a registered 1600x1000 envelope body.

**pocket**

Use case: product-mockup. Asset type: original single front pocket cutout layer of a paper envelope, not a whole envelope. Exactly overhead orthographic view. Shape is a wide 8:5 rectangle with a deep V cut out from its TOP: upper left corner descends diagonally to a central notch 56% down the full height then rises diagonally to upper right corner. Everything ABOVE that V is genuinely transparent; paper fills everything BELOW the V down to a straight bottom edge. Show full isolated shape with a small transparent margin. Warm ivory #fffaf3 uncoated cotton rag paper, tactile fine irregular fibers, delicate deckled outer edges, folded seam construction along lower diagonals, realistic paper thickness on the V opening. Light from upper left, small soft contact shadow lower right. No top flap, no back panel, no letter inside, no seal, no text, no logo, no decoration, no people, buildings or watermark. Precise flat registration suitable for stacking onto a 1600x1000 rectangular envelope back.

**flapFront**

Use case: product-mockup. Asset type: original single triangular envelope flap FRONT cutout. One downward-pointing wide isosceles triangle of warm ivory #fffaf3 handmade cotton-rag paper, perfectly overhead orthographic. Width-to-height ratio 1600:600. Long perfectly horizontal straight top edge is its hinge; left and right edges descend to a slightly rounded center point at bottom. Full triangle visible with small transparent margin; actual alpha transparency outside triangle. Fine natural cotton fibers, softly tactile surface, slight deckled cut edges, thin physical paper thickness and small soft shadow below edges. Lighting from upper left, restrained realistic warm studio photography. Blank unprinted paper only: no envelope body, no back panel, no seal, no text, letters, monogram, watermark, flowers, people or buildings. This is an isolated physical paper flap, never a whole envelope.

**flapBack**

Use case: product-mockup. Asset type: original single triangular envelope flap REVERSE face cutout. One downward-pointing wide isosceles triangle of warm ivory #fffaf3 handmade cotton-rag paper, perfectly overhead orthographic. Width-to-height ratio 1600:600. Long horizontal top edge is the straight hinge, edges descend to a slightly rounded centered bottom point. Full triangle with small transparent margin, actual alpha background. Show its inner paper surface, slightly smoother compressed cotton fibers, with a very delicate 12-pixel-wide translucent gum band just INSIDE the two diagonal edges, never a dark outline. Soft upper-left studio lighting consistent with luxury cotton stationery, delicate thickness/deckle. Blank paper only, no envelope body, seal, letters, logo, watermark, floral decoration, people or buildings.

**letter**

Use case: product-mockup. Asset type: original blank letter paper cutout. A single landscape 14:9 cotton-rag letter sheet, perfectly overhead orthographic, edges parallel to image frame, all four edges visible with small transparent margin. Genuine alpha transparency outside the paper. Warm #fffaf3 center with subtle random visible fine cotton fibers and feathered delicate deckle perimeter; softly irregular handmade edge, never rough torn damage. Soft studio light from upper left, very subtle edge thickness. Leave all paper empty, pristine and unprinted to receive live HTML text. No text, lettering, monograms, logos, marks, ornament, flowers, people, buildings, props or watermark.

**seal**

Use case: product-mockup. Asset type: original unlettered sage wax seal cutout for a paper invitation. A single round hand-poured wax seal photographed exactly overhead on genuine transparent background. Dusty sage #a9b8a0 wax with softly glossy upper-left light reflections, a raised irregular pooled wax rim, a fine circular inner impression, and a completely smooth BLANK center. Tactile, small natural pouring irregularities and realistic wax thickness, muted translucent wax; lower-right soft contact shadow tight to the seal. Entire circular seal visible, centered, generous transparent margin, square crop. No letters, initials, monogram, symbol, logo, floral embossing, text, envelope, paper background, objects, people, architecture or watermark. Luxury artisan stationery material, not a plastic button.

**sprig**

Use case: stylized-concept. Asset type: original small watercolor botanical sprig for a refined invitation paper still life. One delicate asymmetric upright sprig with a small soft coral and peach garden rose, one ivory bud and airy sage-green leaves on two fine stems. True transparent background. Portrait 2:3 composition, full botanical visible with generous clear alpha margin, sparse delicate branching, room between individual leaves, tiny luminous watercolor washes and natural pigment bloom. Soft upper-left lighting impression, muted #a9b8a0 sage and warm coral colors on warm ivory UI. No enclosing frame, no giant corner bouquet, no text, initials, monogram, logo, people, buildings or watermark. Original botanical decoration only.

**edge**

Use case: product-mockup. Asset type: original narrow horizontal handmade paper edge decoration for below-fold invitation. One long warm ivory #fffaf3 cotton-rag paper strip, width-to-height ratio about 7:1, viewed perfectly overhead, isolated on genuine transparent background with all edges visible. Long upper edge softly straight, lower edge delicately deckled with visible tiny cotton fibers; natural physical sheet thickness, subtle fine paper texture. Restrained soft upper-left studio light, a tiny lower-right contact shadow. Empty unprinted paper, no text, symbols, logos, decoration, flowers, people, buildings or watermark.
