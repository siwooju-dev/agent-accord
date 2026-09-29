/** Design directions ("시안") the reviewer can switch between from the top bar. */
export type LookId = "clear" | "studio";

export interface Look {
  id: LookId;
  key: string;
  name: string;
  tagline: string;
  swatch: [string, string, string];
  dark: boolean;
  themeColor: string;
}

export const LOOKS: Look[] = [
  {
    id: "clear",
    key: "A",
    name: "Clear",
    tagline: "밝고 친절한 핀테크 톤",
    swatch: ["#ffffff", "#3182f6", "#191f28"],
    dark: false,
    themeColor: "#f2f4f6",
  },
  {
    id: "studio",
    key: "D",
    name: "Studio",
    tagline: "하드웨어 제품 같은 무광 그레이 · 오렌지",
    swatch: ["#e7e7e3", "#ff5a1f", "#111111"],
    dark: false,
    themeColor: "#e7e7e3",
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
  const look = lookById(id);
  document.documentElement.dataset.look = look.id;
  document.documentElement.style.colorScheme = look.dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", look.themeColor);
}
