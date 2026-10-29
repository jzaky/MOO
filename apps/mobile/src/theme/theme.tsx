import { createContext, use, type ReactNode } from "react";
import { palettes, radius, space, type, type Palette } from "./tokens";

export interface Theme {
  scheme: "dark" | "light";
  c: Palette;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
}

const ThemeContext = createContext<Theme>({ scheme: "dark", c: palettes.dark, space, radius, type });

/** Dark by default. Light mode is wired but not yet user-selectable. */
export function ThemeProvider({ scheme = "dark", children }: { scheme?: "dark" | "light"; children: ReactNode }) {
  return <ThemeContext value={{ scheme, c: palettes[scheme], space, radius, type }}>{children}</ThemeContext>;
}

export function useTheme(): Theme {
  return use(ThemeContext);
}
