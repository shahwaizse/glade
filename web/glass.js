/*
 * Liquid glass displacement map, after kube.io/blog/liquid-glass-css-svg.
 *
 * We render a displacement map on a canvas: neutral gray (no shift) in the
 * middle, with red/green channel gradients near the edges that bend the
 * backdrop like the curved rim of a glass slab. The result is fed to the
 * #liquid-glass SVG filter's feImage, which backdrop-filter then applies.
 */
(function () {
  const W = 320, H = 96;          // proportions of the command bar
  const RADIUS = H / 2;           // fully rounded pill
  const BEZEL = 26;               // rim width in px where refraction happens

  // signed distance to a rounded rectangle (negative inside)
  function sdRoundedRect(x, y, w, h, r) {
    const qx = Math.abs(x) - (w / 2 - r);
    const qy = Math.abs(y) - (h / 2 - r);
    const dx = Math.max(qx, 0), dy = Math.max(qy, 0);
    return Math.hypot(dx, dy) + Math.min(Math.max(qx, qy), 0) - r;
  }

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(W, H);
  const data = img.data;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = px - W / 2, y = py - H / 2;
      const d = sdRoundedRect(x, y, W, H, RADIUS); // <= 0 inside
      // refraction strength: 0 deep inside, ramping up smoothly toward the rim
      let t = 0;
      if (d > -BEZEL) {
        t = 1 - Math.max(0, -d) / BEZEL;
        t = t * t * (3 - 2 * t); // smoothstep
      }
      // displace outward-to-inward along the surface normal (approx: radial)
      const len = Math.hypot(x, y) || 1;
      const nx = x / len, ny = y / len;
      const i = (py * W + px) * 4;
      data[i]     = Math.round(128 + nx * t * 110); // R: x shift
      data[i + 1] = Math.round(128 + ny * t * 110); // G: y shift
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const feImage = document.getElementById("lg-map");
  if (feImage) {
    feImage.setAttribute("href", canvas.toDataURL());
  }

  // Firefox can't apply url() filters in backdrop-filter — fall back gracefully.
  const supportsSvgBackdrop =
    CSS.supports("backdrop-filter", "url(#liquid-glass)") ||
    CSS.supports("-webkit-backdrop-filter", "blur(2px)");
  if (!supportsSvgBackdrop) {
    document.documentElement.style.setProperty("--glass-tint", "rgba(120,124,130,0.24)");
  }
})();
