/** Design directions ("시안") the reviewer can switch between from the top bar. */
export type LookId = "clear" | "aurora" | "graphite" | "studio";

export interface GpuPalette {
  shroud: number;
  shroudRoughness: number;
  shroudMetalness: number;
  iridescence: number;
  sheen: number;
  trim: number;
  blade: number;
  bladeOpacity: number;
  hub: number;
  accent: number;
  accentGlow: number;
  backplate: number;
  pcb: number;
  fins: number;
  shadow: string;
  exposure: number;
  envIntensity: number;
  rimIntensity: number;
  groundShadow: number;
}

export interface Look {
  id: LookId;
  key: string;
  name: string;
  tagline: string;
  swatch: [string, string, string];
  dark: boolean;
  gpu: GpuPalette;
}

export const LOOKS: Look[] = [
  {
    id: "clear",
    key: "A",
    name: "Clear",
    tagline: "밝고 친절한 핀테크 톤",
    swatch: ["#ffffff", "#3182f6", "#191f28"],
    dark: false,
    gpu: {
      shroud: 0xf4f7fb,
      shroudRoughness: 0.28,
      shroudMetalness: 0.05,
      iridescence: 0,
      sheen: 0.25,
      trim: 0xc9d3e0,
      blade: 0xdfe6ef,
      bladeOpacity: 0.92,
      hub: 0xffffff,
      accent: 0x3182f6,
      accentGlow: 1.6,
      backplate: 0xc4cedb,
      pcb: 0x1d2a3a,
      fins: 0xd5dde7,
      shadow: "rgba(49, 102, 180, 0.34)",
      exposure: 1.05,
      envIntensity: 1,
      rimIntensity: 0.6,
      groundShadow: 0.16,
    },
  },
  {
    id: "aurora",
    key: "B",
    name: "Aurora",
    tagline: "그라데이션과 유리 질감의 프리미엄 SaaS",
    swatch: ["#fbfaff", "#6d4aff", "#ff7ac6"],
    dark: false,
    gpu: {
      shroud: 0xf6f2ff,
      shroudRoughness: 0.18,
      shroudMetalness: 0.1,
      iridescence: 0.85,
      sheen: 0.7,
      trim: 0xd9cffb,
      blade: 0xeee8ff,
      bladeOpacity: 0.8,
      hub: 0xffffff,
      accent: 0x8b6bff,
      accentGlow: 1.8,
      backplate: 0xe2dcf7,
      pcb: 0x2a2150,
      fins: 0xe8e2fb,
      shadow: "rgba(109, 74, 255, 0.32)",
      exposure: 1.1,
      envIntensity: 1.1,
      rimIntensity: 0.9,
      groundShadow: 0.14,
    },
  },
  {
    id: "graphite",
    key: "C",
    name: "Graphite",
    tagline: "절제된 다크 · 유리 패널",
    swatch: ["#0b0c0e", "#8b7cff", "#f7f8f8"],
    dark: true,
    gpu: {
      shroud: 0x202227,
      shroudRoughness: 0.42,
      shroudMetalness: 0.55,
      iridescence: 0,
      sheen: 0,
      trim: 0x3a3d45,
      blade: 0x16171b,
      bladeOpacity: 1,
      hub: 0x2a2c32,
      accent: 0x8b7cff,
      accentGlow: 3.2,
      backplate: 0x2b2e35,
      pcb: 0x121418,
      fins: 0x6b707a,
      shadow: "rgba(0, 0, 0, 0.7)",
      exposure: 0.95,
      envIntensity: 0.55,
      rimIntensity: 1.8,
      groundShadow: 0.45,
    },
  },
  {
    id: "studio",
    key: "D",
    name: "Studio",
    tagline: "하드웨어 제품 같은 무광 그레이 · 오렌지",
    swatch: ["#e7e7e3", "#ff5a1f", "#111111"],
    dark: false,
    gpu: {
      shroud: 0xd8d8d3,
      shroudRoughness: 0.72,
      shroudMetalness: 0,
      iridescence: 0,
      sheen: 0,
      trim: 0xb8b8b2,
      blade: 0x2a2a2a,
      bladeOpacity: 1,
      hub: 0xff5a1f,
      accent: 0xff5a1f,
      accentGlow: 1.3,
      backplate: 0x9d9d97,
      pcb: 0x1e1e1e,
      fins: 0xc4c4be,
      shadow: "rgba(40, 40, 36, 0.38)",
      exposure: 1,
      envIntensity: 0.9,
      rimIntensity: 0.4,
      groundShadow: 0.22,
    },
  },
];

export const lookById = (id: string | null | undefined): Look => LOOKS.find((look) => look.id === id) ?? LOOKS[0];

const STORAGE_KEY = "accord.look";

export function readStoredLook(): LookId {
  try {
    const fromHash = window.location.hash.replace("#", "");
    if (LOOKS.some((look) => look.id === fromHash)) return fromHash as LookId;
    return lookById(window.localStorage.getItem(STORAGE_KEY)).id;
  } catch {
    return LOOKS[0].id;
  }
}

export function storeLook(id: LookId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage can be unavailable (private mode); the look still applies for this visit */
  }
  document.documentElement.dataset.look = id;
  document.documentElement.style.colorScheme = lookById(id).dark ? "dark" : "light";
}
