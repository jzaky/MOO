import { describe, expect, it } from "vitest";
import { acceptsExerciseMatch, detectImportSource, exerciseQueries, parseCsv, parseDuration, parseImport, parseLocalDateTime, ImportFormatError } from "../src";

const strong = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-10-20 07:45:12,"Push, heavy",1h 5m,"Bench Press (Barbell)",W,40.0,10,0,0,"","Felt strong",
2026-10-20 07:45:12,"Push, heavy",1h 5m,"Bench Press (Barbell)",1,80.0,8,0,0,"paused reps","Felt strong",8
2026-10-20 07:45:12,"Push, heavy",1h 5m,"Bench Press (Barbell)",2,80.0,7,0,0,"","Felt strong",9
2026-10-20 07:45:12,"Push, heavy",1h 5m,"Bench Press (Barbell)",D,60.0,10,0,0,"","Felt strong",
2026-10-20 07:45:12,"Push, heavy",1h 5m,"Running (Treadmill)",1,0,0,2.0,900,"","Felt strong",
2026-10-22 18:10:00,"Legs",45m,"Squat (Barbell)",1,100,5,0,0,"","",
`;

const hevy = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Upper A","20 Oct 2026, 07:45","20 Oct 2026, 08:50","","Bench Press (Barbell)",,"",0,"warmup",40,10,,,
"Upper A","20 Oct 2026, 07:45","20 Oct 2026, 08:50","","Bench Press (Barbell)",,"",1,"normal",80,8,,,8.5
"Upper A","20 Oct 2026, 07:45","20 Oct 2026, 08:50","","Lat Pulldown (Cable)",,"",0,"normal",55,12,,,
"Upper A","20 Oct 2026, 07:45","20 Oct 2026, 08:50","","Lat Pulldown (Cable)",,"",1,"failure",55,10,,,
`;

const mfp = `Date,Meal,Time,Calories,Fat (g),Saturated Fat,Polyunsaturated Fat,Monounsaturated Fat,Trans Fat,Cholesterol,Sodium (mg),Potassium,Carbohydrates (g),Fiber,Sugar,Protein (g),Vitamin A,Vitamin C,Calcium,Iron,Note
2026-10-20,Breakfast,,420,12,3,2,5,0,180,450,300,55,6,12,24,10,5,15,10,
2026-10-20,Lunch,,650.5,20,6,4,8,0,90,900,700,70,9,8,45,4,30,8,20,"office canteen"
2026-10-20,Snacks,,180,8,,,,,,120,,20,2,15,6,,,,,
2026-10-20,Snacks,,100,,,,,,,,,10,,,5,,,,,
`;

describe("CSV reading", () => {
  it("handles quotes, embedded commas and newlines, CRLF, BOM and semicolons", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"\nthere']]);
    expect(parseCsv("a;b;c\n1,5;2;3\n")).toEqual([["a", "b", "c"], ["1,5", "2", "3"]]);
  });
  it("reads the date and time formats these apps use", () => {
    expect(parseLocalDateTime("2026-10-20 07:45:12")).toEqual({ day: "2026-10-20", time: "07:45" });
    expect(parseLocalDateTime("8 Jan 2026, 18:29")).toEqual({ day: "2026-01-08", time: "18:29" });
    expect(parseLocalDateTime("Jan 8, 2026, 6:29 PM")).toEqual({ day: "2026-01-08", time: "18:29" });
    expect(parseLocalDateTime("2026-10-20")).toEqual({ day: "2026-10-20", time: "12:00" });
    expect(parseLocalDateTime("yesterday")).toBeNull();
    expect([parseDuration("1h 5m"), parseDuration("45m"), parseDuration("3600"), parseDuration("")]).toEqual([3900, 2700, 3600, null]);
  });
});

describe("Strong export", () => {
  it("groups sets into workouts, keeps set types, converts pounds and skips cardio with a warning", () => {
    const r = parseImport(strong, { weightUnit: "lb" });
    expect(r.source).toBe("strong");
    expect(r.workouts).toHaveLength(2);
    const push = r.workouts[0]!;
    expect(push).toMatchObject({ name: "Push, heavy", day: "2026-10-20", time: "07:45", durationSec: 3900, notes: "Felt strong" });
    expect(push.exercises).toHaveLength(1);
    expect(push.exercises[0]!.sets.map((s) => [s.kind, s.reps, s.rpe])).toEqual([["warmup", 10, null], ["working", 8, 8], ["working", 7, 9], ["drop", 10, null]]);
    expect(push.exercises[0]!.sets[1]!.weightKg).toBeCloseTo(36.29, 2);
    expect(r.warnings.join(" ")).toMatch(/1 cardio set/);
  });
  it("reads kilograms as given", () => {
    expect(parseImport(strong, { weightUnit: "kg" }).workouts[1]!.exercises[0]!.sets[0]!.weightKg).toBe(100);
  });
});

describe("Hevy export", () => {
  it("parses Hevy's dates, set types and kilograms, with duration from start and end", () => {
    const r = parseImport(hevy, { weightUnit: "lb" });
    expect(r.source).toBe("hevy");
    expect(r.workouts).toHaveLength(1);
    const w = r.workouts[0]!;
    expect(w).toMatchObject({ name: "Upper A", day: "2026-10-20", time: "07:45", durationSec: 65 * 60 });
    expect(w.exercises.map((e) => e.name)).toEqual(["Bench Press (Barbell)", "Lat Pulldown (Cable)"]);
    expect(w.exercises[0]!.sets.map((s) => [s.kind, s.weightKg, s.reps, s.rpe])).toEqual([["warmup", 40, 10, null], ["working", 80, 8, 8.5]]);
    expect(w.exercises[1]!.sets[1]!.kind).toBe("failure");
  });
});

describe("MyFitnessPal exports", () => {
  it("imports one entry per meal per day and never turns blanks into zeros", () => {
    const r = parseImport(mfp, { weightUnit: "kg" });
    expect(r.source).toBe("mfp_nutrition");
    expect(r.meals.map((m) => m.meal)).toEqual(["breakfast", "lunch", "snacks"]);
    expect(r.meals[1]).toMatchObject({ note: "office canteen", nutrients: { energyKcal: 650.5, proteinG: 45, sodiumMg: 900 } });
    const snacks = r.meals[2]!.nutrients;
    expect(snacks.energyKcal).toBe(280);
    expect(snacks.carbsG).toBe(30);
    expect(snacks.fatG).toBeNull(); // known on one row only: the total is unknown
    expect("vitaminCMg" in r.meals[0]!.nutrients).toBe(false); // %DV columns are not amounts
  });
  it("imports weigh-ins in the unit the header states", () => {
    const r = parseImport("Date,Weight (lbs)\n2026-10-20,180\n2026-10-21,\n", { weightUnit: "kg" });
    expect(r.source).toBe("mfp_measurements");
    expect(r.weights).toEqual([{ day: "2026-10-20", kg: 81.65 }]);
    expect(r.warnings[0]).toMatch(/1 row without/);
  });
});

describe("format detection and exercise names", () => {
  it("rejects files it does not understand", () => {
    expect(detectImportSource(["foo", "bar"])).toBeNull();
    expect(() => parseImport("foo,bar\n1,2\n", { weightUnit: "kg" })).toThrow(ImportFormatError);
  });
  it("turns other apps' exercise names into catalogue searches", () => {
    expect(exerciseQueries("Bench Press (Barbell)")).toEqual(["barbell bench press", "bench press", "bench press (barbell)"]);
    expect(exerciseQueries("Pull Up")).toEqual(["pull up"]);
    expect(exerciseQueries("Lat Pulldown (Cable)")[0]).toBe("cable lat pulldown");
  });
});

describe("exercise match acceptance", () => {
  it("accepts the same exercise and rejects look-alikes or other equipment", () => {
    expect(acceptsExerciseMatch("Bench Press (Barbell)", "Barbell Bench Press")).toBe(true);
    expect(acceptsExerciseMatch("Squat (Barbell)", "Barbell Back Squat")).toBe(true);
    expect(acceptsExerciseMatch("Pull Up", "Pull-Up")).toBe(true);
    expect(acceptsExerciseMatch("Bicep Curl (Dumbbell)", "Dumbbell Biceps Curl")).toBe(true);
    expect(acceptsExerciseMatch("Zercher Carry (Barbell)", "Barbell Back Squat")).toBe(false);
    expect(acceptsExerciseMatch("Bench Press (Dumbbell)", "Barbell Bench Press")).toBe(false);
    expect(acceptsExerciseMatch("Incline Bench Press (Dumbbell)", "Dumbbell Bench Press")).toBe(false);
  });
});
