import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { streamFdcFoods } from "../src/db/importFdc";

describe("USDA bulk file streaming", () => {
  it("yields each food without loading the whole file, whatever the strings contain", async () => {
    const foods = [
      { fdcId: 1, description: 'Odd "quoted" {brace} [bracket] \\ name', foodNutrients: [{ nutrientNumber: "208", value: 100 }] },
      { fdcId: 2, description: "Plain", foodPortions: [{ gramWeight: 50, modifier: "cup}" }] },
    ];
    const file = path.join(mkdtempSync(path.join(tmpdir(), "fdc-")), "f.json");
    writeFileSync(file, JSON.stringify({ SRLegacyFoods: foods }, null, 2));
    const out = [];
    for await (const f of streamFdcFoods(file)) out.push(f);
    expect(out).toEqual(foods);
  });
});
