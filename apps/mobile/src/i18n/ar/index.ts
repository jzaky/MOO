import type { Dict } from "../index";
import { core } from "./core";
import { nutrition } from "./nutrition";
import { plans } from "./plans";
import { training } from "./training";

/** All Arabic strings. Areas are split only to keep files manageable; a key may appear once. */
export const AR: Dict = { ...core, ...nutrition, ...training, ...plans };
export const AR_AREAS: Record<string, Dict> = { core, nutrition, training, plans };
