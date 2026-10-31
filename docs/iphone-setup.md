# Getting Stoke onto your iPhone

**Quickest: the website.** Step 1 below (the Render deploy) also puts the whole app online as a website at your Render address, e.g. `https://stoke-api.onrender.com`. Open it in Safari on the iPhone, sign up, and use **Share → Add to Home Screen** for an app icon. It needs no Apple account and no build. In a browser, Apple Health, the widgets, the watch app and Siri are not available, and the camera features depend on the browser allowing the camera.

**The native app** (steps 2–5) adds those. No Mac is needed. Expo's build service (EAS) compiles the iPhone app in the cloud, and the server runs on Render. You need about an hour the first time, a computer with Node 22 (Windows, Linux or Mac), and:

- an **Apple Developer Program** membership (US$99/year), required to install your own app on a real iPhone;
- a free **Expo** account (expo.dev);
- a **Render** account (render.com). A web service with a disk and a database are paid plans; check render.com/pricing (roughly the cost of a couple of coffees a month at the smallest sizes);
- an **Anthropic API key** for photo logging, label and menu reading, and the coach (the rest of the app works without it).

## 1. Put the server online (Render)

1. In Render: **New → Blueprint**, connect GitHub and pick this repository (branch `claude/beautiful-galileo-la7tue` until it is merged). Render reads `render.yaml` and creates the server (which also serves the website), a PostgreSQL 16 database and a 1 GB disk for photos. The first build takes several minutes because it also builds the website.
2. When asked, paste your `ANTHROPIC_API_KEY`, or leave it empty for now. Every other secret is generated. Without a key the app runs normally and the AI features (photo logging, label and menu reading, coach) say they aren't set up yet.

   **Adding the key later:** in Render open the `stoke-api` service → **Environment** → set `ANTHROPIC_API_KEY` (create one at console.anthropic.com) → **Save changes**. Render restarts the service with the key; nothing else to do, and your data is kept.
3. Wait for the first deploy. The server creates its database roles, applies migrations and loads the exercise catalogue, then downloads the USDA food catalogue and the UAE dishes in the background (a couple of minutes).
4. Copy the service URL, e.g. `https://stoke-api.onrender.com`, and check `https://…/health` shows `{"ok":true}`. Opening the URL itself shows the app.

## 2. Point the app at your server

In `apps/mobile/eas.json`, replace `https://REPLACE-WITH-YOUR-API-HOST` with your Render URL. Commit and push.

## 3. Build and install

On your computer, in the repository:

```bash
pnpm install
npm install -g eas-cli
cd apps/mobile
eas login
eas init                 # creates the Expo project; if it can't edit the config, copy the
                         # projectId it prints into app.json → expo.extra.eas.projectId
eas device:create        # open the link on your iPhone to register it
eas build -p ios --profile first-device
```

During the first build EAS asks you to sign in with your Apple ID and creates the certificate and provisioning profile for you.

When it finishes, open the build link on the iPhone and install. On iOS 16 or later, turn on **Settings → Privacy & Security → Developer Mode** the first time (the phone restarts).

The `first-device` profile leaves out the parts that add extra iOS targets (widgets, rest-timer Live Activity, Apple Watch app, Siri shortcuts), because that native code has not been compiled yet. Everything else is included: logging, barcode, camera, voice, Apple Health, workouts, form check, Arabic.

## 4. Add the extras

Once the first build works, build again with everything:

```bash
eas build -p ios --profile preview
```

This adds the widget extension, the watch app and the Siri intents. EAS will create provisioning profiles for `com.stoke.fitness.widgets` and `com.stoke.fitness.watchkitapp` and the App Group `group.com.stoke.fitness`. If the Swift code fails to compile, the build log names the file and line; send it over to be fixed.

## 5. Later: TestFlight

`eas build -p ios --profile production` then `eas submit -p ios` uploads to App Store Connect for TestFlight. Push notifications also need the Expo project id from step 3.

## Checklist on the phone

Tick these off and record the results in `docs/STATUS.md`:

- [ ] Sign up, onboarding, Today screen loads from your server
- [ ] Barcode scan of a few UAE products; photo of a meal (needs the API key)
- [ ] Voice logging (needs a speech-to-text server, see `STT_URL`; otherwise it says so)
- [ ] Apple Health permission and sync
- [ ] A full workout in airplane mode, then reconnect and check it synced
- [ ] Form check with the camera
- [ ] Settings → Language → العربية, close and reopen: layout is right to left
- [ ] Notifications (needs the Expo project id)
- [ ] After the `preview` build: widgets, rest-timer on the lock screen, watch app, "Hey Siri, log food in Stoke"
