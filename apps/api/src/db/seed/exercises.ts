/**
 * Original exercise catalogue authored for this project (licence:
 * proprietary-original). Exercise names, muscle involvement and equipment
 * are general facts; all instruction text here is written from scratch. No
 * text or media was copied from wger, exercemus, free-exercise-db or other
 * datasets (see docs/research/03-recipes-and-movement.md for why).
 *
 * Muscle vocabulary: chest, front_delts, side_delts, rear_delts, triceps,
 * biceps, forearms, lats, upper_back, traps, lower_back, abs, obliques,
 * glutes, quads, hamstrings, adductors, abductors, calves, hip_flexors.
 */

export interface SeedExercise {
  slug: string;
  name: string;
  aliases?: string[];
  primary: string[];
  secondary?: string[];
  equipment: "barbell" | "dumbbell" | "kettlebell" | "machine" | "cable" | "bodyweight" | "band" | "smith_machine" | "cardio_machine" | "pullup_bar";
  category?: "strength" | "cardio" | "mobility";
  pattern: "horizontal_push" | "vertical_push" | "horizontal_pull" | "vertical_pull" | "squat" | "hinge" | "lunge" | "carry" | "core" | "isolation" | "cardio" | "mobility";
  mechanics?: "compound" | "isolation";
  difficulty?: "beginner" | "intermediate" | "advanced";
  load?: "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight";
  unilateral?: boolean;
  steps: string[];
  cautions?: string;
  alternatives?: string[];
}

export const EXERCISES: SeedExercise[] = [
  // ── Chest ──
  { slug: "barbell-bench-press", name: "Barbell Bench Press", aliases: ["bench press", "bench", "flat bench"], primary: ["chest"], secondary: ["front_delts", "triceps"], equipment: "barbell", pattern: "horizontal_push", mechanics: "compound", difficulty: "intermediate", load: "barbell",
    steps: ["Lie on the bench with eyes under the bar, feet planted and shoulder blades pulled back.", "Grip slightly wider than shoulder width and unrack with straight arms.", "Lower the bar under control to the lower chest, elbows roughly 45–70° from the torso.", "Press back up to straight arms without losing the shoulder-blade position."],
    cautions: "Use safety arms or a spotter when working close to failure.", alternatives: ["dumbbell-bench-press", "machine-chest-press", "push-up"] },
  { slug: "incline-barbell-bench-press", name: "Incline Barbell Bench Press", aliases: ["incline bench"], primary: ["chest", "front_delts"], secondary: ["triceps"], equipment: "barbell", pattern: "horizontal_push", mechanics: "compound", difficulty: "intermediate", load: "barbell",
    steps: ["Set the bench to about 30°.", "Unrack with shoulder blades retracted and lower the bar to the upper chest.", "Press up and slightly back toward the rack position."], alternatives: ["incline-dumbbell-press", "machine-chest-press"] },
  { slug: "dumbbell-bench-press", name: "Dumbbell Bench Press", aliases: ["db bench", "dumbbell press"], primary: ["chest"], secondary: ["front_delts", "triceps"], equipment: "dumbbell", pattern: "horizontal_push", mechanics: "compound", load: "dumbbell",
    steps: ["Sit with the dumbbells on your thighs, then lie back and bring them to chest level.", "Press up until the arms are straight, dumbbells slightly closer than at the bottom.", "Lower with control until you feel a stretch across the chest."], alternatives: ["barbell-bench-press", "push-up", "machine-chest-press"] },
  { slug: "incline-dumbbell-press", name: "Incline Dumbbell Press", aliases: ["incline db press", "incline dumbbell bench"], primary: ["chest", "front_delts"], secondary: ["triceps"], equipment: "dumbbell", pattern: "horizontal_push", mechanics: "compound", load: "dumbbell",
    steps: ["Set the bench to 15–30°.", "Start with dumbbells at upper-chest height, elbows under the wrists.", "Press up and slightly inward; lower until a comfortable stretch."], alternatives: ["incline-barbell-bench-press", "machine-chest-press"] },
  { slug: "machine-chest-press", name: "Machine Chest Press", aliases: ["chest press"], primary: ["chest"], secondary: ["front_delts", "triceps"], equipment: "machine", pattern: "horizontal_push", mechanics: "compound", difficulty: "beginner", load: "machine",
    steps: ["Adjust the seat so the handles line up with mid-chest.", "Press forward to straight arms without shrugging.", "Return slowly until the chest stretches."], alternatives: ["dumbbell-bench-press", "push-up"] },
  { slug: "cable-fly", name: "Cable Fly", aliases: ["cable crossover", "cable chest fly"], primary: ["chest"], secondary: ["front_delts"], equipment: "cable", pattern: "isolation", mechanics: "isolation", load: "cable",
    steps: ["Set pulleys around shoulder height and step forward into a split stance.", "With a soft bend in the elbows, bring the handles together in front of the chest.", "Open back out under control until the chest stretches."], alternatives: ["dumbbell-fly", "pec-deck"] },
  { slug: "dumbbell-fly", name: "Dumbbell Fly", primary: ["chest"], equipment: "dumbbell", pattern: "isolation", mechanics: "isolation", load: "dumbbell",
    steps: ["Lie on a flat bench with dumbbells over the chest, palms facing.", "Keeping a fixed slight elbow bend, lower the arms out to the sides.", "Stop at a comfortable stretch and bring the dumbbells back together."], cautions: "Keep the range of motion comfortable for the shoulders.", alternatives: ["cable-fly", "pec-deck"] },
  { slug: "pec-deck", name: "Pec Deck", aliases: ["machine fly", "pec fly"], primary: ["chest"], equipment: "machine", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "machine",
    steps: ["Adjust the seat so the handles are at chest height.", "Bring the handles together in front of you with a slight elbow bend.", "Return slowly to the start."], alternatives: ["cable-fly", "dumbbell-fly"] },
  { slug: "push-up", name: "Push-Up", aliases: ["pushup", "press-up", "push ups"], primary: ["chest"], secondary: ["front_delts", "triceps", "abs"], equipment: "bodyweight", pattern: "horizontal_push", mechanics: "compound", difficulty: "beginner", load: "bodyweight",
    steps: ["Start in a high plank with hands slightly wider than the shoulders.", "Keep the body in a straight line and lower the chest toward the floor.", "Push the floor away back to straight arms."], alternatives: ["incline-push-up", "dumbbell-bench-press"] },
  { slug: "incline-push-up", name: "Incline Push-Up", aliases: ["elevated push up"], primary: ["chest"], secondary: ["triceps", "front_delts"], equipment: "bodyweight", pattern: "horizontal_push", mechanics: "compound", difficulty: "beginner", load: "bodyweight",
    steps: ["Place hands on a bench or box.", "Keep a straight body line and lower the chest to the edge.", "Press back up. Lower the surface over time to make it harder."], alternatives: ["push-up"] },
  { slug: "dip", name: "Dip", aliases: ["parallel bar dip", "chest dip", "dips"], primary: ["chest", "triceps"], secondary: ["front_delts"], equipment: "bodyweight", pattern: "vertical_push", mechanics: "compound", difficulty: "intermediate", load: "bodyweight",
    steps: ["Support yourself on parallel bars with straight arms.", "Lean slightly forward and lower until the shoulders are just below the elbows or as far as comfortable.", "Press back up to straight arms."], cautions: "Limit depth if the front of the shoulder is uncomfortable.", alternatives: ["assisted-dip", "close-grip-bench-press"] },
  { slug: "assisted-dip", name: "Assisted Dip (Machine)", aliases: ["machine assisted dip"], primary: ["chest", "triceps"], secondary: ["front_delts"], equipment: "machine", pattern: "vertical_push", mechanics: "compound", difficulty: "beginner", load: "machine",
    steps: ["Kneel or stand on the assistance pad and grip the bars.", "Lower under control, then press back up.", "Reduce the assistance as you get stronger."], alternatives: ["dip"] },

  // ── Shoulders ──
  { slug: "overhead-press", name: "Overhead Press", aliases: ["ohp", "military press", "barbell shoulder press", "standing press"], primary: ["front_delts"], secondary: ["side_delts", "triceps", "upper_back"], equipment: "barbell", pattern: "vertical_push", mechanics: "compound", difficulty: "intermediate", load: "barbell",
    steps: ["Hold the bar at the front of the shoulders, grip just outside shoulder width.", "Brace the trunk and squeeze the glutes.", "Press the bar straight up, moving the head back slightly to clear it, then under the bar at the top.", "Lower to the shoulders with control."], alternatives: ["dumbbell-shoulder-press", "machine-shoulder-press"] },
  { slug: "dumbbell-shoulder-press", name: "Dumbbell Shoulder Press", aliases: ["db shoulder press", "seated dumbbell press"], primary: ["front_delts"], secondary: ["side_delts", "triceps"], equipment: "dumbbell", pattern: "vertical_push", mechanics: "compound", load: "dumbbell",
    steps: ["Sit on an upright bench with dumbbells at shoulder height.", "Press up until the arms are straight overhead.", "Lower back to shoulder height."], alternatives: ["overhead-press", "machine-shoulder-press"] },
  { slug: "machine-shoulder-press", name: "Machine Shoulder Press", primary: ["front_delts"], secondary: ["side_delts", "triceps"], equipment: "machine", pattern: "vertical_push", mechanics: "compound", difficulty: "beginner", load: "machine",
    steps: ["Adjust the seat so handles start around shoulder height.", "Press up to straight arms.", "Lower slowly."], alternatives: ["dumbbell-shoulder-press"] },
  { slug: "lateral-raise", name: "Dumbbell Lateral Raise", aliases: ["side raise", "lateral raises", "side lateral raise"], primary: ["side_delts"], equipment: "dumbbell", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "dumbbell",
    steps: ["Stand holding light dumbbells at your sides.", "Raise the arms out to the sides to about shoulder height, elbows slightly bent.", "Lower slowly without swinging."], alternatives: ["cable-lateral-raise", "machine-lateral-raise"] },
  { slug: "cable-lateral-raise", name: "Cable Lateral Raise", primary: ["side_delts"], equipment: "cable", pattern: "isolation", mechanics: "isolation", load: "cable", unilateral: true,
    steps: ["Set a pulley low and hold the handle with the far hand.", "Raise the arm out to the side to shoulder height.", "Lower under control; repeat on the other side."], alternatives: ["lateral-raise"] },
  { slug: "machine-lateral-raise", name: "Machine Lateral Raise", primary: ["side_delts"], equipment: "machine", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "machine",
    steps: ["Align the shoulders with the machine's pivot.", "Raise the pads out to the sides.", "Return slowly."], alternatives: ["lateral-raise"] },
  { slug: "rear-delt-fly", name: "Rear Delt Fly", aliases: ["reverse fly", "bent over reverse fly"], primary: ["rear_delts"], secondary: ["upper_back"], equipment: "dumbbell", pattern: "isolation", mechanics: "isolation", load: "dumbbell",
    steps: ["Hinge forward with a flat back, dumbbells hanging below the chest.", "Raise the arms out to the sides, leading with the elbows.", "Lower under control."], alternatives: ["reverse-pec-deck", "face-pull"] },
  { slug: "reverse-pec-deck", name: "Reverse Pec Deck", aliases: ["machine reverse fly"], primary: ["rear_delts"], secondary: ["upper_back"], equipment: "machine", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "machine",
    steps: ["Face the machine with handles at shoulder height.", "Sweep the arms back and out.", "Return slowly."], alternatives: ["rear-delt-fly", "face-pull"] },
  { slug: "face-pull", name: "Face Pull", primary: ["rear_delts"], secondary: ["upper_back", "traps"], equipment: "cable", pattern: "horizontal_pull", mechanics: "isolation", load: "cable",
    steps: ["Set a rope attachment at upper-chest to face height.", "Pull the rope toward your face, separating the hands and keeping elbows high.", "Return with control."], alternatives: ["reverse-pec-deck", "rear-delt-fly"] },

  // ── Back ──
  { slug: "pull-up", name: "Pull-Up", aliases: ["pullup", "pull ups", "chin-up bar pull up"], primary: ["lats"], secondary: ["biceps", "upper_back", "rear_delts"], equipment: "pullup_bar", pattern: "vertical_pull", mechanics: "compound", difficulty: "intermediate", load: "bodyweight",
    steps: ["Hang from the bar with an overhand grip slightly wider than shoulders.", "Pull the chest toward the bar by driving the elbows down.", "Lower to a full hang under control."], alternatives: ["lat-pulldown", "assisted-pull-up", "chin-up"] },
  { slug: "chin-up", name: "Chin-Up", aliases: ["chinup", "chin ups"], primary: ["lats", "biceps"], secondary: ["upper_back"], equipment: "pullup_bar", pattern: "vertical_pull", mechanics: "compound", difficulty: "intermediate", load: "bodyweight",
    steps: ["Hang with an underhand, shoulder-width grip.", "Pull until the chin clears the bar.", "Lower to a full hang."], alternatives: ["pull-up", "lat-pulldown"] },
  { slug: "assisted-pull-up", name: "Assisted Pull-Up (Machine)", primary: ["lats"], secondary: ["biceps", "upper_back"], equipment: "machine", pattern: "vertical_pull", mechanics: "compound", difficulty: "beginner", load: "machine",
    steps: ["Kneel on the assistance pad and grip the handles.", "Pull up until the chin passes the handles.", "Lower slowly; reduce assistance over time."], alternatives: ["lat-pulldown", "pull-up"] },
  { slug: "lat-pulldown", name: "Lat Pulldown", aliases: ["pulldown", "wide grip pulldown", "lat pull down"], primary: ["lats"], secondary: ["biceps", "upper_back"], equipment: "cable", pattern: "vertical_pull", mechanics: "compound", difficulty: "beginner", load: "cable",
    steps: ["Sit with thighs under the pads and grip the bar slightly wider than shoulders.", "Pull the bar to the upper chest, driving the elbows down.", "Let the bar rise under control until the arms are straight."], alternatives: ["pull-up", "assisted-pull-up"] },
  { slug: "barbell-row", name: "Barbell Row", aliases: ["bent over row", "bb row", "pendlay row"], primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps", "lower_back"], equipment: "barbell", pattern: "horizontal_pull", mechanics: "compound", difficulty: "intermediate", load: "barbell",
    steps: ["Hinge forward with a flat back, bar hanging at arm's length.", "Row the bar to the lower ribs, squeezing the shoulder blades together.", "Lower under control without standing up."], cautions: "Keep the lower back neutral; reduce load if it rounds.", alternatives: ["chest-supported-row", "seated-cable-row", "dumbbell-row"] },
  { slug: "dumbbell-row", name: "One-Arm Dumbbell Row", aliases: ["db row", "single arm row"], primary: ["lats", "upper_back"], secondary: ["rear_delts", "biceps"], equipment: "dumbbell", pattern: "horizontal_pull", mechanics: "compound", load: "dumbbell", unilateral: true,
    steps: ["Support one hand and knee on a bench, back flat.", "Row the dumbbell toward the hip.", "Lower until the arm is straight; switch sides."], alternatives: ["seated-cable-row", "chest-supported-row"] },
  { slug: "seated-cable-row", name: "Seated Cable Row", aliases: ["cable row", "low row"], primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps"], equipment: "cable", pattern: "horizontal_pull", mechanics: "compound", difficulty: "beginner", load: "cable",
    steps: ["Sit tall with feet on the platform and a slight knee bend.", "Pull the handle to the lower ribs, chest up.", "Let the arms extend fully while keeping the torso still."], alternatives: ["chest-supported-row", "dumbbell-row"] },
  { slug: "chest-supported-row", name: "Chest-Supported Row", aliases: ["machine row", "seal row", "t-bar row machine"], primary: ["upper_back"], secondary: ["lats", "rear_delts", "biceps"], equipment: "machine", pattern: "horizontal_pull", mechanics: "compound", difficulty: "beginner", load: "machine",
    steps: ["Lie chest-down on the pad.", "Row the handles back, squeezing the shoulder blades.", "Lower to full arm extension."], alternatives: ["seated-cable-row", "dumbbell-row"] },
  { slug: "straight-arm-pulldown", name: "Straight-Arm Pulldown", primary: ["lats"], equipment: "cable", pattern: "isolation", mechanics: "isolation", load: "cable",
    steps: ["Stand facing a high pulley holding a bar or rope.", "With nearly straight arms, sweep the bar down to the thighs.", "Return slowly overhead."], alternatives: ["lat-pulldown"] },
  { slug: "barbell-shrug", name: "Barbell Shrug", aliases: ["shrugs"], primary: ["traps"], equipment: "barbell", pattern: "isolation", mechanics: "isolation", load: "barbell",
    steps: ["Hold the bar at arm's length.", "Lift the shoulders straight up toward the ears.", "Pause, then lower."], alternatives: ["dumbbell-shrug"] },
  { slug: "dumbbell-shrug", name: "Dumbbell Shrug", primary: ["traps"], equipment: "dumbbell", pattern: "isolation", mechanics: "isolation", load: "dumbbell",
    steps: ["Hold dumbbells at your sides.", "Shrug straight up, pause, and lower."], alternatives: ["barbell-shrug"] },

  // ── Legs ──
  { slug: "back-squat", name: "Barbell Back Squat", aliases: ["squat", "back squat", "squats", "barbell squat"], primary: ["quads", "glutes"], secondary: ["adductors", "lower_back"], equipment: "barbell", pattern: "squat", mechanics: "compound", difficulty: "intermediate", load: "barbell",
    steps: ["Place the bar on the upper back and unrack with feet about shoulder width.", "Brace, then sit down between the hips, knees tracking over the toes.", "Descend as deep as you can with a neutral spine.", "Drive up through the whole foot to standing."], cautions: "Squat inside a rack with safety bars set just below your bottom position.", alternatives: ["goblet-squat", "leg-press", "hack-squat"] },
  { slug: "front-squat", name: "Front Squat", primary: ["quads"], secondary: ["glutes", "abs", "upper_back"], equipment: "barbell", pattern: "squat", mechanics: "compound", difficulty: "advanced", load: "barbell",
    steps: ["Rest the bar on the front of the shoulders, elbows high.", "Squat down keeping the torso upright.", "Stand up while keeping the elbows high."], alternatives: ["goblet-squat", "back-squat"] },
  { slug: "goblet-squat", name: "Goblet Squat", primary: ["quads", "glutes"], secondary: ["abs"], equipment: "dumbbell", pattern: "squat", mechanics: "compound", difficulty: "beginner", load: "dumbbell",
    steps: ["Hold a dumbbell vertically against the chest.", "Squat down between the knees with an upright torso.", "Stand back up."], alternatives: ["back-squat", "leg-press"] },
  { slug: "hack-squat", name: "Hack Squat (Machine)", primary: ["quads"], secondary: ["glutes"], equipment: "machine", pattern: "squat", mechanics: "compound", load: "machine",
    steps: ["Set shoulders under the pads and feet mid-platform.", "Release the safeties and lower until the thighs are at least parallel.", "Press back up."], alternatives: ["leg-press", "back-squat"] },
  { slug: "leg-press", name: "Leg Press", primary: ["quads", "glutes"], secondary: ["adductors"], equipment: "machine", pattern: "squat", mechanics: "compound", difficulty: "beginner", load: "machine",
    steps: ["Sit with the back flat against the pad and feet hip-width on the platform.", "Lower the sled until the knees are well bent without the lower back lifting off the pad.", "Press back up without locking the knees hard."], alternatives: ["hack-squat", "goblet-squat"] },
  { slug: "smith-machine-squat", name: "Smith Machine Squat", primary: ["quads", "glutes"], equipment: "smith_machine", pattern: "squat", mechanics: "compound", load: "barbell",
    steps: ["Set the bar on the upper back with feet slightly forward.", "Squat down under control.", "Drive back up."], alternatives: ["back-squat", "leg-press"] },
  { slug: "bulgarian-split-squat", name: "Bulgarian Split Squat", aliases: ["rear foot elevated split squat", "bss"], primary: ["quads", "glutes"], secondary: ["adductors"], equipment: "dumbbell", pattern: "lunge", mechanics: "compound", difficulty: "intermediate", load: "dumbbell", unilateral: true,
    steps: ["Stand in front of a bench and place the rear foot on it.", "Lower the back knee toward the floor, front shin roughly vertical.", "Drive up through the front foot; switch legs."], alternatives: ["walking-lunge", "reverse-lunge"] },
  { slug: "walking-lunge", name: "Walking Lunge", aliases: ["lunges"], primary: ["quads", "glutes"], secondary: ["adductors", "hamstrings"], equipment: "dumbbell", pattern: "lunge", mechanics: "compound", load: "dumbbell", unilateral: true,
    steps: ["Hold dumbbells at your sides.", "Step forward and lower until both knees are bent about 90°.", "Push off and step through into the next lunge."], alternatives: ["reverse-lunge", "bulgarian-split-squat"] },
  { slug: "reverse-lunge", name: "Reverse Lunge", primary: ["quads", "glutes"], secondary: ["hamstrings"], equipment: "dumbbell", pattern: "lunge", mechanics: "compound", difficulty: "beginner", load: "dumbbell", unilateral: true,
    steps: ["Stand tall holding dumbbells.", "Step back and lower the back knee toward the floor.", "Return to standing; alternate legs."], alternatives: ["walking-lunge", "bulgarian-split-squat"] },
  { slug: "leg-extension", name: "Leg Extension", primary: ["quads"], equipment: "machine", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "machine",
    steps: ["Align the knee with the machine pivot, pad on the lower shin.", "Extend the knees fully.", "Lower under control."], alternatives: ["goblet-squat"] },
  { slug: "romanian-deadlift", name: "Romanian Deadlift", aliases: ["rdl", "romanian dl", "stiff leg deadlift"], primary: ["hamstrings", "glutes"], secondary: ["lower_back", "forearms"], equipment: "barbell", pattern: "hinge", mechanics: "compound", difficulty: "intermediate", load: "barbell",
    steps: ["Stand holding the bar at the hips with soft knees.", "Push the hips back, sliding the bar down the thighs with a flat back.", "Stop when the hamstrings are well stretched and the back is still neutral.", "Drive the hips forward to stand."], alternatives: ["dumbbell-romanian-deadlift", "seated-leg-curl"] },
  { slug: "dumbbell-romanian-deadlift", name: "Dumbbell Romanian Deadlift", aliases: ["db rdl"], primary: ["hamstrings", "glutes"], secondary: ["lower_back"], equipment: "dumbbell", pattern: "hinge", mechanics: "compound", load: "dumbbell",
    steps: ["Hold dumbbells in front of the thighs.", "Hinge at the hips with soft knees and a flat back.", "Return to standing by driving the hips forward."], alternatives: ["romanian-deadlift"] },
  { slug: "deadlift", name: "Barbell Deadlift", aliases: ["deadlift", "conventional deadlift", "deadlifts"], primary: ["glutes", "hamstrings", "lower_back"], secondary: ["quads", "traps", "forearms", "upper_back"], equipment: "barbell", pattern: "hinge", mechanics: "compound", difficulty: "advanced", load: "barbell",
    steps: ["Stand with mid-foot under the bar and grip just outside the legs.", "Bring shins to the bar, chest up, back flat, and take the slack out of the bar.", "Push the floor away and stand up with the bar close to the legs.", "Return the bar to the floor with the same flat-back position."], cautions: "Technique deteriorates with fatigue; stop sets before the back rounds.", alternatives: ["trap-bar-deadlift", "romanian-deadlift"] },
  { slug: "trap-bar-deadlift", name: "Trap Bar Deadlift", aliases: ["hex bar deadlift"], primary: ["quads", "glutes", "hamstrings"], secondary: ["lower_back", "traps"], equipment: "barbell", pattern: "hinge", mechanics: "compound", difficulty: "intermediate", load: "barbell",
    steps: ["Stand inside the trap bar and grip the handles.", "With a flat back, push through the floor to stand up.", "Lower under control."], alternatives: ["deadlift", "leg-press"] },
  { slug: "hip-thrust", name: "Barbell Hip Thrust", aliases: ["hip thrusts", "glute bridge barbell"], primary: ["glutes"], secondary: ["hamstrings"], equipment: "barbell", pattern: "hinge", mechanics: "compound", load: "barbell",
    steps: ["Sit with upper back against a bench, bar padded across the hips.", "Drive the hips up until the torso is level, chin slightly tucked.", "Lower the hips under control."], alternatives: ["glute-bridge", "cable-pull-through"] },
  { slug: "glute-bridge", name: "Glute Bridge", primary: ["glutes"], secondary: ["hamstrings"], equipment: "bodyweight", pattern: "hinge", mechanics: "compound", difficulty: "beginner", load: "bodyweight",
    steps: ["Lie on your back with knees bent and feet flat.", "Squeeze the glutes and lift the hips.", "Lower slowly."], alternatives: ["hip-thrust"] },
  { slug: "cable-pull-through", name: "Cable Pull-Through", primary: ["glutes", "hamstrings"], equipment: "cable", pattern: "hinge", mechanics: "compound", load: "cable",
    steps: ["Face away from a low pulley holding a rope between the legs.", "Hinge back, then drive the hips forward to stand tall."], alternatives: ["hip-thrust", "romanian-deadlift"] },
  { slug: "lying-leg-curl", name: "Lying Leg Curl", aliases: ["leg curl", "hamstring curl"], primary: ["hamstrings"], secondary: ["calves"], equipment: "machine", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "machine",
    steps: ["Lie face down with the pad just above the heels.", "Curl the heels toward the glutes.", "Lower slowly."], alternatives: ["seated-leg-curl"] },
  { slug: "seated-leg-curl", name: "Seated Leg Curl", primary: ["hamstrings"], equipment: "machine", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "machine",
    steps: ["Sit with the knee aligned to the pivot and the thigh pad secure.", "Curl the pad down and back.", "Return under control."], alternatives: ["lying-leg-curl"] },
  { slug: "hip-adduction-machine", name: "Hip Adduction (Machine)", aliases: ["adductor machine"], primary: ["adductors"], equipment: "machine", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "machine",
    steps: ["Sit with pads on the inner knees.", "Squeeze the legs together.", "Open slowly."], alternatives: [] },
  { slug: "hip-abduction-machine", name: "Hip Abduction (Machine)", aliases: ["abductor machine"], primary: ["abductors", "glutes"], equipment: "machine", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "machine",
    steps: ["Sit with pads on the outer knees.", "Push the legs apart.", "Return slowly."], alternatives: [] },
  { slug: "standing-calf-raise", name: "Standing Calf Raise", aliases: ["calf raise", "calf raises"], primary: ["calves"], equipment: "machine", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "machine",
    steps: ["Stand with the balls of the feet on the platform edge.", "Lower the heels to a stretch, then rise as high as possible.", "Pause briefly at the top."], alternatives: ["seated-calf-raise"] },
  { slug: "seated-calf-raise", name: "Seated Calf Raise", primary: ["calves"], equipment: "machine", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "machine",
    steps: ["Sit with the pad on the lower thighs and balls of the feet on the platform.", "Lower to a stretch, then press up as high as possible."], alternatives: ["standing-calf-raise"] },

  // ── Arms ──
  { slug: "barbell-curl", name: "Barbell Curl", aliases: ["bicep curl barbell", "bb curl"], primary: ["biceps"], secondary: ["forearms"], equipment: "barbell", pattern: "isolation", mechanics: "isolation", load: "barbell",
    steps: ["Stand holding the bar with an underhand, shoulder-width grip.", "Curl the bar up keeping elbows at your sides.", "Lower fully under control."], alternatives: ["dumbbell-curl", "cable-curl"] },
  { slug: "dumbbell-curl", name: "Dumbbell Curl", aliases: ["bicep curl", "db curl", "biceps curls"], primary: ["biceps"], secondary: ["forearms"], equipment: "dumbbell", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "dumbbell",
    steps: ["Stand with dumbbells at your sides, palms forward.", "Curl up without swinging.", "Lower slowly."], alternatives: ["barbell-curl", "cable-curl"] },
  { slug: "hammer-curl", name: "Hammer Curl", primary: ["biceps", "forearms"], equipment: "dumbbell", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "dumbbell",
    steps: ["Hold dumbbells with palms facing each other.", "Curl up keeping the neutral grip.", "Lower under control."], alternatives: ["dumbbell-curl"] },
  { slug: "incline-dumbbell-curl", name: "Incline Dumbbell Curl", primary: ["biceps"], equipment: "dumbbell", pattern: "isolation", mechanics: "isolation", load: "dumbbell",
    steps: ["Sit back on a bench inclined to about 45°, arms hanging.", "Curl without moving the upper arm forward.", "Lower to a full stretch."], alternatives: ["dumbbell-curl"] },
  { slug: "cable-curl", name: "Cable Curl", primary: ["biceps"], equipment: "cable", pattern: "isolation", mechanics: "isolation", load: "cable",
    steps: ["Face a low pulley holding a straight bar.", "Curl up keeping elbows still.", "Lower slowly."], alternatives: ["dumbbell-curl"] },
  { slug: "preacher-curl", name: "Preacher Curl", primary: ["biceps"], equipment: "machine", pattern: "isolation", mechanics: "isolation", load: "machine",
    steps: ["Rest the backs of the upper arms on the pad.", "Curl the handle or bar up.", "Lower to nearly straight arms."], alternatives: ["cable-curl", "dumbbell-curl"] },
  { slug: "triceps-pushdown", name: "Triceps Pushdown", aliases: ["tricep pushdown", "cable pushdown", "rope pushdown"], primary: ["triceps"], equipment: "cable", pattern: "isolation", mechanics: "isolation", difficulty: "beginner", load: "cable",
    steps: ["Face a high pulley with a rope or bar.", "With elbows at your sides, press down until the arms are straight.", "Let the handle rise to about chest height."], alternatives: ["overhead-triceps-extension", "close-grip-bench-press"] },
  { slug: "overhead-triceps-extension", name: "Overhead Cable Triceps Extension", aliases: ["overhead extension", "overhead tricep extension"], primary: ["triceps"], equipment: "cable", pattern: "isolation", mechanics: "isolation", load: "cable",
    steps: ["Face away from the pulley holding the rope overhead.", "Extend the elbows to straighten the arms.", "Return to a deep stretch behind the head."], alternatives: ["triceps-pushdown", "skull-crusher"] },
  { slug: "skull-crusher", name: "EZ-Bar Skull Crusher", aliases: ["lying triceps extension", "skullcrusher"], primary: ["triceps"], equipment: "barbell", pattern: "isolation", mechanics: "isolation", load: "barbell",
    steps: ["Lie on a bench holding the bar over the chest.", "Bend the elbows to lower the bar toward the forehead or just behind the head.", "Extend back up."], cautions: "Use a controlled tempo and comfortable range for the elbows.", alternatives: ["overhead-triceps-extension"] },
  { slug: "close-grip-bench-press", name: "Close-Grip Bench Press", primary: ["triceps", "chest"], secondary: ["front_delts"], equipment: "barbell", pattern: "horizontal_push", mechanics: "compound", load: "barbell",
    steps: ["Grip the bar about shoulder width.", "Lower to the lower chest with elbows closer to the body.", "Press up."], alternatives: ["dip", "triceps-pushdown"] },

  // ── Core ──
  { slug: "plank", name: "Plank", aliases: ["front plank"], primary: ["abs"], secondary: ["obliques"], equipment: "bodyweight", pattern: "core", mechanics: "isolation", difficulty: "beginner", load: "bodyweight",
    steps: ["Support yourself on forearms and toes.", "Keep a straight line from head to heels, squeezing glutes and abs.", "Hold for time while breathing steadily."], alternatives: ["dead-bug"] },
  { slug: "dead-bug", name: "Dead Bug", primary: ["abs"], equipment: "bodyweight", pattern: "core", mechanics: "isolation", difficulty: "beginner", load: "bodyweight",
    steps: ["Lie on your back with arms up and knees over hips.", "Keeping the lower back down, extend the opposite arm and leg.", "Return and alternate."], alternatives: ["plank"] },
  { slug: "hanging-leg-raise", name: "Hanging Leg Raise", primary: ["abs", "hip_flexors"], equipment: "pullup_bar", pattern: "core", mechanics: "isolation", difficulty: "intermediate", load: "bodyweight",
    steps: ["Hang from a bar.", "Raise the legs by curling the pelvis up.", "Lower without swinging."], alternatives: ["cable-crunch"] },
  { slug: "cable-crunch", name: "Cable Crunch", primary: ["abs"], equipment: "cable", pattern: "core", mechanics: "isolation", load: "cable",
    steps: ["Kneel facing a high pulley holding a rope by the head.", "Crunch the ribs toward the pelvis.", "Return slowly."], alternatives: ["hanging-leg-raise"] },
  { slug: "pallof-press", name: "Pallof Press", primary: ["obliques", "abs"], equipment: "cable", pattern: "core", mechanics: "isolation", load: "cable", unilateral: true,
    steps: ["Stand side-on to a chest-height pulley holding the handle at the chest.", "Press the handle straight out and resist rotating.", "Return to the chest; repeat on both sides."], alternatives: ["plank"] },
  { slug: "farmers-carry", name: "Farmer's Carry", aliases: ["farmer walk", "farmers walk"], primary: ["forearms", "traps"], secondary: ["abs", "glutes"], equipment: "dumbbell", pattern: "carry", mechanics: "compound", difficulty: "beginner", load: "dumbbell",
    steps: ["Pick up heavy dumbbells or kettlebells.", "Walk tall with short, controlled steps.", "Set the weights down with a flat back."], alternatives: [] },
  { slug: "kettlebell-swing", name: "Kettlebell Swing", aliases: ["kb swing"], primary: ["glutes", "hamstrings"], secondary: ["lower_back", "abs"], equipment: "kettlebell", pattern: "hinge", mechanics: "compound", load: "dumbbell",
    steps: ["Hike the kettlebell back between the legs with a flat back.", "Snap the hips forward so the bell floats to about chest height.", "Let it fall back into the next hinge."], alternatives: ["romanian-deadlift", "cable-pull-through"] },

  // ── Cardio & conditioning ──
  { slug: "treadmill-walk", name: "Treadmill Walk", aliases: ["walking", "incline walk"], primary: ["calves", "quads"], equipment: "cardio_machine", category: "cardio", pattern: "cardio", mechanics: "compound", difficulty: "beginner", load: "bodyweight",
    steps: ["Walk at a pace you can sustain while talking.", "Add incline to increase intensity."], alternatives: ["outdoor-walk", "stationary-bike"] },
  { slug: "outdoor-walk", name: "Outdoor Walk", primary: ["calves", "quads"], equipment: "bodyweight", category: "cardio", pattern: "cardio", mechanics: "compound", difficulty: "beginner", load: "bodyweight",
    steps: ["Walk at a brisk, comfortable pace."], cautions: "In hot climates walk early or late and hydrate.", alternatives: ["treadmill-walk"] },
  { slug: "running", name: "Running", aliases: ["run", "jog", "jogging"], primary: ["quads", "calves"], secondary: ["hamstrings", "glutes"], equipment: "bodyweight", category: "cardio", pattern: "cardio", mechanics: "compound", load: "bodyweight",
    steps: ["Run with relaxed shoulders and short, quick steps.", "Keep most runs at an easy, conversational pace."], alternatives: ["stationary-bike", "rowing-machine"] },
  { slug: "stationary-bike", name: "Stationary Bike", aliases: ["bike", "cycling", "spin bike"], primary: ["quads"], secondary: ["glutes", "calves"], equipment: "cardio_machine", category: "cardio", pattern: "cardio", mechanics: "compound", difficulty: "beginner", load: "bodyweight",
    steps: ["Set the saddle so the knee is slightly bent at the bottom of the pedal stroke.", "Ride at a steady effort, or alternate harder and easier intervals."], alternatives: ["rowing-machine", "treadmill-walk"] },
  { slug: "rowing-machine", name: "Rowing Machine", aliases: ["rower", "erg", "rowing"], primary: ["upper_back", "quads"], secondary: ["glutes", "hamstrings", "lats"], equipment: "cardio_machine", category: "cardio", pattern: "cardio", mechanics: "compound", load: "bodyweight",
    steps: ["Push with the legs first, then swing the torso back, then pull the handle to the ribs.", "Return in reverse order: arms, torso, legs."], alternatives: ["stationary-bike"] },
  { slug: "elliptical", name: "Elliptical", primary: ["quads"], secondary: ["glutes", "calves"], equipment: "cardio_machine", category: "cardio", pattern: "cardio", mechanics: "compound", difficulty: "beginner", load: "bodyweight",
    steps: ["Move at a steady rhythm, pushing and pulling the handles."], alternatives: ["stationary-bike"] },
  { slug: "stair-climber", name: "Stair Climber", aliases: ["stairmaster", "stepmill"], primary: ["quads", "glutes"], secondary: ["calves"], equipment: "cardio_machine", category: "cardio", pattern: "cardio", mechanics: "compound", load: "bodyweight",
    steps: ["Climb at a steady pace without leaning heavily on the rails."], alternatives: ["treadmill-walk"] },
  { slug: "jump-rope", name: "Jump Rope", aliases: ["skipping"], primary: ["calves"], secondary: ["quads"], equipment: "bodyweight", category: "cardio", pattern: "cardio", mechanics: "compound", load: "bodyweight",
    steps: ["Jump just high enough to clear the rope, landing softly on the balls of the feet."], alternatives: ["stationary-bike"] },

  // ── Mobility ──
  { slug: "hip-flexor-stretch", name: "Half-Kneeling Hip Flexor Stretch", primary: ["hip_flexors"], equipment: "bodyweight", category: "mobility", pattern: "mobility", mechanics: "isolation", difficulty: "beginner", load: "bodyweight", unilateral: true,
    steps: ["Kneel on one knee with the other foot in front.", "Tuck the pelvis and shift forward until the front of the rear hip stretches.", "Hold 30–60 seconds per side."], alternatives: [] },
  { slug: "thoracic-rotation", name: "Open-Book Thoracic Rotation", primary: ["upper_back"], equipment: "bodyweight", category: "mobility", pattern: "mobility", mechanics: "isolation", difficulty: "beginner", load: "bodyweight", unilateral: true,
    steps: ["Lie on your side with knees bent and arms together in front.", "Rotate the top arm open toward the floor behind you, following it with your eyes.", "Return slowly; repeat on both sides."], alternatives: [] },
  { slug: "deep-squat-hold", name: "Deep Squat Hold", primary: ["adductors", "hip_flexors"], equipment: "bodyweight", category: "mobility", pattern: "mobility", mechanics: "isolation", difficulty: "beginner", load: "bodyweight",
    steps: ["Sit into a deep squat, holding a support if needed.", "Keep heels down and chest up; breathe and hold 30–60 seconds."], alternatives: [] },
];
