

export const THEME = {
  name: "Daylight",
  bg: "#FAFAFA",
  card: "#FFFFFF",
  cardBorder: "rgba(var(--ink-rgb),0.09)",
  accent: "#111111",
  accent2: "#5C5C5C",
  accent3: "#2E2E2E",
  accentRgb: "17, 17, 17",
  accentFg: "#FFFFFF", // text/icons that sit on an accent or ink surface
  accentGlow: "rgba(var(--accent-rgb),0.12)",
  accentDim: "rgba(var(--accent-rgb),0.10)",
  accentBorder: "rgba(var(--accent-rgb),0.22)",
  // Identity "pop" color — the original brand orange in light mode; dark mode
  // swaps to acid chartreuse (see DARK below) where orange would feel muddy.
  pop: "#F35627",
  pop2: "#D63E1A",
  popRgb: "243, 86, 39",
  popFg: "#FFFFFF", // text/icons sitting on a solid pop surface
  textDim: "rgba(var(--ink-rgb),0.80)",
  textMuted: "rgba(var(--ink-rgb),0.66)",
  ink: "#15171a", // primary text color
  inkRgb: "17, 24, 28", // ink as rgb — tints borders/fills/overlays; flips in dark
  inkSoft: "rgba(var(--ink-rgb),0.60)",
  earn: "#52525B",
  violet: "#3F3F46",
  surface: "#FFFFFF",
  surface2: "#F1F3F4",
  headerBg: "rgba(255,255,255,0.82)",
  fieldBg: "rgba(var(--ink-rgb),0.03)",
  fieldBorder: "rgba(var(--ink-rgb),0.08)",
  scrim: "rgba(var(--ink-rgb),0.22)", // modal backdrop — stays dark in both modes
  blur: "blur(16px)",
  logoFilter: "none", // brand mark is black; inverted to white in dark mode
};

// Dark counterpart. Same keys as THEME so the CSS-variable block can swap wholesale.
export const DARK = {
  name: "Midnight",
  bg: "#0E1011",
  card: "#17191B",
  cardBorder: "rgba(255,255,255,0.10)",
  accent: "#ECEDEE",
  accent2: "#9BA0A6",
  accent3: "#C9CDD2",
  accentRgb: "236, 237, 238",
  accentFg: "#15171a",
  accentGlow: "rgba(var(--accent-rgb),0.10)",
  accentDim: "rgba(var(--accent-rgb),0.08)",
  accentBorder: "rgba(var(--accent-rgb),0.20)",
  pop: "#EDF973",
  pop2: "#CBD94A",
  popRgb: "237, 249, 115",
  popFg: "#161900",
  textDim: "rgba(236,237,238,0.80)",
  textMuted: "rgba(236,237,238,0.55)",
  ink: "#ECEDEE",
  inkRgb: "236, 237, 238",
  inkSoft: "rgba(236,237,238,0.62)",
  earn: "#A1A1AA",
  violet: "#C4B5FD",
  surface: "#1C1F21",
  surface2: "#26292C",
  headerBg: "rgba(18,20,21,0.82)",
  fieldBg: "rgba(255,255,255,0.04)",
  fieldBorder: "rgba(255,255,255,0.13)",
  scrim: "rgba(0,0,0,0.55)",
  blur: "blur(16px)",
  logoFilter: "invert(1)",
};

export const C = {
  bg: "var(--bg)",
  card: "var(--card-bg)",
  cardBorder: "var(--card-border)",
  accent: "var(--accent)",
  accent2: "var(--accent2)",
  accent3: "var(--accent3)",
  accentGlow: "var(--accent-glow)",
  accentDim: "var(--accent-dim)",
  accentBorder: "var(--accent-border)",
  textDim: "var(--text-dim)",
  textMuted: "var(--text-muted)",
  earn: "var(--earn)",
  violet: "var(--violet)",
  surface: "var(--surface)",
  surface2: "var(--surface2)",
  blur: "var(--blur)",
};

