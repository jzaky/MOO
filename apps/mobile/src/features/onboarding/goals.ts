import { t } from "../../i18n";

export type Goal = "lose_fat" | "build_muscle" | "maintain" | "recomposition" | "strength" | "general_fitness" | "endurance";
/** Goal choices, shared by onboarding and Settings. Labels are built on call so they follow the language. */
export const goalOptions = (): { value: Goal; label: string; body: string }[] => [
  { value: "lose_fat", label: t("Lose body fat"), body: t("A moderate deficit with high protein") },
  { value: "build_muscle", label: t("Build muscle"), body: t("A small surplus and progressive training") },
  { value: "recomposition", label: t("Recomposition"), body: t("Lose fat and gain muscle slowly") },
  { value: "strength", label: t("Get stronger"), body: t("Focus on main lifts") },
  { value: "maintain", label: t("Maintain weight"), body: t("Hold steady, improve habits") },
  { value: "general_fitness", label: t("General fitness"), body: t("Feel better, move more") },
  { value: "endurance", label: t("Improve endurance"), body: t("Conditioning alongside strength") },
];

