# Changelog

## 24 November 2026

- Keep the muscle card the same height in every view on phones. On narrow screens "Volume by muscle group" wrapped to two lines, which made the card taller and squeezed the bodyweight chart only in that view. On phones it now reads "Volume by muscle" on one line. When there is no comparison, as in the last-7-days view, the volume rows drop their empty change column so the bars use the full width, on phones and desktop.
- Make switching to the muscle heatmap smooth. The map starts loading when the Heatmap control is hovered, focused or touched, and waits until the body outlines and every muscle overlay have loaded before appearing in one short fade, instead of the images popping in one at a time. The last map is reused for 30 seconds, so switching back is instant. Changing week keeps the previous map dimmed until the new one is ready, and the loading message only shows if loading takes longer than 0.4 seconds.
- On phones, replace the Volume / Sets / Heatmap buttons in the muscle card with three slim bars beside the title, like the exercise bars in a workout. The card title names the active view, each bar keeps its label for screen readers and a 44px tap target, and the muscle chart gets the freed height, so the radar chart and body map are larger. The bars sit level with the title with no box behind them, including in palette themes such as Nuclear, which gave the old toggle a filled background.
- Add Settings → Dashboard → Sets by muscle chart to choose between the new radar chart (the default) and the previous bar list. The choice is saved on each device, like the color theme, so it needs no server change. The README settings summary now lists it.
- Restore the release size of the muscle heatmap when it shows the last seven days. The "Last 7 days" label now sits under the card title, where other muscle views show it, instead of above the body figures, where it made them smaller.
- Show Sets by muscle as a radar chart. The selected period is a filled outline and the comparison period is a dashed outline, so you can see at a glance which muscles got more or less work. Muscles keep a fixed position around the chart (push, pull, legs, then core), so the shape can be compared week to week. Hover, tap, or use the arrow keys to see a muscle's sets, comparison sets, and change above the chart. The legend shows total sets for each period, and sits in the chart's empty top-left corner when there is room, so the chart can use the full height. The chart is sized from where each muscle name actually sits, so names on diagonal spokes no longer shrink it. Screen readers get a table with every value. Periods with fewer than three trained muscles still use the list. This has not been deployed yet.
- Show the last seven days in Volume by muscle group and Sets by muscle when the current week has no completed workouts.
- Show muscle activity for the last seven days when the current week has no completed workouts, and label the heatmap with that date range.
- Show volume and sessions for the last seven days when the current week has no completed workouts. Last workout now shows how many calendar days have passed since the latest completed session, regardless of the week selected.
- Fix the Nuclear theme looking washed out in the deployed app, with blank swatches in Settings → Themes. Browsers kept an old copy of `/theme-palettes.css` from before Nuclear existed, because public files keep the same URL across releases and nginx sent no caching headers. Builds now add a content hash to `/theme-palettes.css` and `/theme-init.js` in `index.html`, so each release loads its own copy. nginx now tells browsers to revalidate HTML and public files on each load, and to cache the hashed files under `/assets/` for a year. API caching headers are unchanged. A new test fails if a theme in `theme.ts` has no palette block. These changes have not been deployed yet.
- Keep new sign-ins for seven days so Jern can reopen on mobile without another Google sign-in. Signing out still ends the session immediately.
- Add a weight goal under Settings → Goals: No goal, Lose, Maintain, or Gain, with an optional target weight. The goal decides which way the dashboard's monthly weight change is coloured as progress. Maintain counts a change of up to 1 kg a month as progress. With no goal, the change is no longer coloured, where before any gain showed green and any loss red. A target weight can be set with or without a goal. It appears under the Bodyweight title with how much is left, and as a dashed line on the chart when it is close to the logged weights. Without a goal, moving toward the target counts as progress. Migration `0012_weight_goal` adds `weight_goal` and `target_weight` to `account_settings`; local SQLite databases get the columns at startup.
- `PUT /api/v1/settings` now changes only the fields sent, so saving one setting cannot overwrite another. Settings also load when the Dashboard opens, not just Settings.
- Add a Nuclear theme: dark gray backgrounds with a yellow-green (#b8ff1f) as the accent color. The logo mark becomes a radiation trefoil while the theme is active. Choose it under Settings → Themes.

## 23 November 2026

- Skip exercises with no logged sets in the History volume chart and count each workout once per exercise. Completed bodyweight sets can still show 0 kg.
- Show the two cable pushdown names as one Tricep pushdown in exercise search, including partial searches in the workout-day builder, and include both names' logged sets in progress.
- Make custom exercises private to the account that created them. Other accounts could find them, delete them, or relabel a catalogue exercise's muscle. Migration `0011_private_custom_exercises` gives each existing custom exercise to the one account that uses it. Back up before deploying.
- Add `scripts/backup-railway.ps1` to download a verified copy of the production database over `railway ssh`, since Railway's Hobby plan has no volume backups.
- Replace the Render deployment files with `docs/railway-deployment.md`, since Jern is hosted on Railway.
- Default `APP_ENV` to `production` and reject unknown values, so a missing setting cannot turn on development settings. Local development sets `APP_ENV=development`.
- Add a test where a second account tries every ID-based route against the first account's records. It found the shared custom exercises.
- Fix live workouts failing to save with HTTP 409 after leaving and reopening the app on Android. Saves now carry a device id, so a device can retry its own save after a lost response; saves from other devices still conflict. Adds the `workouts.last_writer_id` column (migration `0010_workout_last_writer`).
- Stop showing "TypeError: Failed to fetch" during workouts. Android often cuts the network for a backgrounded app, so the save sent on leaving can fail; it is now retried when the app returns instead.
- Make "Reload saved workout" load the saved copy from the server instead of reloading the page, which restored the same conflicting copy.
- Make Back behave like a native app. Android's Back gesture (and the browser Back button) used to close Jern from any screen. It now closes the open sheet, dialog, or menu first, then returns to the Dashboard, and only leaves the app from the Dashboard. Closing a note or routine with unsaved changes still asks before discarding them. This uses one temporary history entry and does not change the URL.
- Show a dark launch screen with the Jern mark when the app opens from the iPhone Home Screen, so it starts like a native app. Without these images iOS shows a plain screen first. The 26 images cover iPhone screen sizes from the iPhone SE through the iPhone 17 Pro Max and Air, in portrait and landscape. Each device downloads only the one that matches it. Regenerate them with `npm run generate:launch-images`.

## 22 November 2026

- Keep the workout search field, close button, and scrollable results above the mobile keyboard. Closing search returns focus and keeps the workout at the same scroll position.
- Fit Coach and text-entry dialogs to the space above the keyboard, and keep dashboard and More menu actions reachable on short displays.
- Give Home Screen installs a stable app identity, prefer fullscreen where supported, and keep the sign-in screen clear of phone cutouts. Document installation on iPhone and Android.
- Run mobile regression tests in iPhone WebKit and Android Chromium, including simulated keyboard resize and viewport panning.
- Stop iOS from zooming into the History search, calendar pickers, and other small fields when they are focused. In the Home Screen app there was no way to zoom back out. Pinch-zoom still works, and Android is unchanged.
- Keep the phone screen awake while a live workout is open, so it does not lock between sets. The screen sleeps normally on other pages, when editing a past workout, or when the system denies the request (for example in Low Power Mode).
- Refresh the dashboard, history, active workouts, and this month's calendar when the app returns after at least five minutes away. Installed apps resume instead of reloading, so the week view and stats could otherwise be out of date.
- Remove the grey tap flash, double-tap zoom on quick repeated taps, and long-press text selection on buttons. Buttons now dim briefly while pressed. These changes apply only on touch screens.
- Have Coach check recent working sets before suggesting an exercise weight. If no usable sets are logged, it can use a saved routine weight or explain how to choose a starting load.
- Shorten the weight advice instructions to reduce the input tokens sent with each Coach request.

## 20 November 2026

- Make the Playwright iPhone tests start Jern and use mock API responses, so GitHub Actions can verify the dashboard and mobile sign-out without a backend. Upload an HTML report for each run.
- Rework the repository README into features, training and progressive overload, the coach's AI pipeline, a quick start, and a technical overview with architecture diagrams, so new users can understand and run Jern from one page.
- Add a linked backend README so contributors can trace how the API, database, and integrations fit together and run the service locally.
- Add a Sign out button to mobile Settings so users can end their session from either Settings tab.

## 19 November 2026

**Scale desktop UI uniformly on large screens**

- Scale the whole app uniformly on screens larger than 1440 × 810 (for example 1440p and 4K monitors), so text, controls and charts keep the same proportions instead of small text with stretched panels.
- Keep full-height pages exact while scaled by dividing CSS viewport units by the zoom at build time. Smaller screens, phones and Safari are unchanged.

**Animate mobile More menu, lock static pages and add Playwright smoke test**

- Slide the mobile More menu up from the bottom bar when it opens and back down when it closes (0.2 s / 0.15 s, ease-in-out).
- Add a Playwright iPhone 17 WebKit smoke test that checks dashboard width and captures a screenshot.
- Lock fixed-height mobile pages (calendar, dashboard, history, coach) to the visible screen so they no longer scroll or bounce on Android and iOS browsers.

**Make mobile calendar static with inline day actions and label menu**

- Let the mobile month grid fill the free space on every screen size, place workout codes right under their dates, and show a Rest day row on empty days.
- Keep the mobile calendar static: open-planned and remove buttons sit beside the workout, a Label button beside the main action opens a label menu, and rows compact on shorter phones.

**Fix calendar move throttling and polish mobile layouts**

- Apply per-account limits to active sessions so background reads no longer use the sign-in quota and block calendar moves. Refresh each affected month once after a workout is moved.
- Show the mobile weekly plan as a bottom sheet with one row per day instead of an inline panel that overflowed the screen.
- Remove background dimming behind all popups, use a solid page background on phones so the status bar area matches the theme, and add hairline cells to the mobile calendar.

**Redesign mobile calendar with workout type codes and centered layout**

- Redesign the mobile calendar as a compact month grid with workout type codes (F, U, L, Ps, Pl…), label dots, a code legend and a flat selected-day section; routine and weekly planning moved to the ⋯ menu.

**Made dashboard on mobile follow the desktop design language**

- Simplify the mobile dashboard overview to the desktop's flat style: header, a divided stat grid and the week, with shorter stat captions.

**Tweaked mobile dashboard**

- Fit the mobile Progress page on one screen without its title, with a compact muscle card, refined spacing and chart dates clear of the divider.
- Stop Sets by muscle rows overlapping on mobile; the list now scrolls with full-height rows.

**Restored the original orange-brown as palette color to default theme**

- Restore the original orange-brown for below-goal steps and shorter sleep durations in both Default appearances.

**Tweaked dashboard and menu on mobile**

- Remove the background dimming behind the mobile More menu, keep the bottom bar tappable while it is open, and close the menu from any bar button.
- Fit the mobile dashboard overview on one screen without scrolling, with Log workout beside the week selector.

**Centered the mobile Resume icon and the AI Coach Stop response icon**

- Center the mobile Resume icon and the Coach stop-response icon.

**Tweaked Themes**

- Use vivid red for muscle heatmap highlights and the legend in Carbon Black, Midnight Blue, and Blackberry.

**Fixed calender drag and drop feature**

- Fix calendar workout drag and drop on desktop and mobile. Drag a workout to an empty day without shifting the calendar grid during the gesture.

**Fixed the mobile Sleep Last 7 days chart on mobile bars now follow the active theme**

- Match the mobile 7-day Sleep duration bars to the active theme, including nights below the weekly average.

**Add color themes and refine below-goal step colors**

- Add eight color themes with palette previews in Settings. Default remembers its Light or Dark preference, while each custom theme has a fixed appearance.
- Give below-goal steps a distinct color in every theme, including both Default appearances, on the daily progress bar and weekly chart.
- Revert an exercise swap to restore its original sets and notes, even after resuming a workout. The swap picker offers the last substitute for that exercise on the current device.

**Added Settings + Ai output preference**

- Show response-length save progress in the shared bottom-right indicator.
- Match the selected response length and appearance to the sidebar's rounded, muted green highlight.
- Add Settings to the desktop sidebar and mobile More menu. AI preferences save Brief, Normal, or Comprehensive per account and apply to new and retried Coach replies. The Themes tab switches between Light and Dark for the current device.

**Match status bar and page background to the app theme**

- Use the exact visible page colours (`#111a14` dark, `#f3f5f0` light) for the browser theme colour, page background and web app manifest, so the Android status bar and iOS overscroll areas blend into the app in both themes. The mobile dashboard backdrop now follows the theme instead of staying dark in light mode.
- Match the page background and browser theme colour to dark mode, so the iOS home-screen app no longer shows a light strip behind the Dynamic Island or when overscrolling. The saved theme is applied before the app loads, through a same-origin script that the existing Content Security Policy allows.

**Rework the Workout history layout so the page reads as one master/detail view**

- Rework the Workout history layout so the page reads as one master/detail view: the Sessions/Analysis switch now sits beside a smaller title with a session and volume summary, and search and the period filter sit above the list they filter.
- Show per-month session counts in the list and mark the selected session with the sidebar's soft green highlight instead of an outline.
- Give the session details a single scroll area instead of a boxed inner scroller, a divided stat row (exercises, sets, volume, duration), and grouped header actions: Log again, Edit session, and a menu for notes and deletion.
- Show each exercise's volume and set count on the right of its row, show notes as an inline card with a quick Add note button, and hide the one-line set summary while set details are expanded.
- Keep stats on one row on narrower desktops and use the same stat row and actions in the mobile session sheet.

## 18 November 2026

**Fixed the count-up animations for Current weight, Weekly volume, and Sessions**

- Keep dashboard metrics at full size throughout their count-up animations and hide the final value until the count finishes.

**Fixed the gap at 24:00 on Activity Chart. now the ring closes fully when the animation finishes**

- Close the Activity clock's sweep cleanly so the finished ring has no gap at midnight.

**On desktop, Edit goal now sits beside step progress and opens a compact dialog**

- Add all-time steps and days at the current target from synced Google Health history, and move desktop goal editing beside step progress.
- Show just the question in coach chats started from Health while keeping the selected readings available to the coach.

**Refine Health layouts and animate charts and headline metrics**

- Animate Health headline numbers and charts as views appear, including a clockwise Activity clock reveal. Today's active minutes count up only on page load.
- Enlarge the desktop Activity clock and show yesterday's active minutes in smaller text beside it.
- Move activity totals below the mobile clock so the chart can use more of the card width.
- Mark the saved daily goal with a dashed line on the seven-day Steps chart and show its label on desktop.
- Let the mobile Steps chart use the available height and make swiping consistent across Health tabs.
- Enlarge the mobile Activity clock and align the smaller active-minute total with the heading.
- Align the mobile Health action buttons with the two overview card columns.
- Move the mobile Health sync status beside the page title to free up vertical space.
- Bring the desktop charts to mobile Health, with steps, activity, and recovery
  charts grouped together on their respective tabs.

**Refine Health charts and add topic-based coach prompts**

- Show yesterday’s active minutes in a smaller summary above the Activity clock.
- Pin the Activity clock to yesterday with a fixed 24-hour face and refresh it at local midnight.
- Replace the Health Workouts tab with a rolling 24-hour activity clock for
  synced sleep, walking, and workouts. Use asleep stages for sleep duration and
  mark gaps as untracked.
- Refine the Ask coach dialog typography and let users dismiss it by clicking outside.
- Let users add a custom question when sharing a Health topic with the coach.
- Give shared primary buttons a flat green fill and white text, matching the
  selected Health tab in dark mode.
- Add an Ask coach dialog in the Health header that shares readings for one
  selected topic: Sleep, Activity, Steps, or Recovery.
- Remove the Recovery coach shortcut and show the selected baseline directly
  on the chart, with more room for the daily readings.
- Show a switchable HRV and resting heart rate line chart beneath the desktop
  Recovery baseline, with a reference line for the selected metric's average.

**Tweaked step graph colors**

- Use the low-sleep color for step bars and daily progress below the step goal.

**Overhauled Health frontend**

- Use the dashboard bar green consistently across Health charts and step progress.
- Match desktop sleep chart colors to mobile so nights below the seven-day
  average are easy to spot.
- Fill the available height on mobile Health with weekly summaries and compact
  daily readings. Combine recovery history in one view, bring goal editing
  into Steps Today, and paginate long lists. Show seven days of sleep in readable
  rows under the stage timeline, with a compact layout for shorter screens.
- Let the Health grid and charts grow with the desktop viewport so taller
  laptops and large monitors can use more of the screen. Limit chart height
  so daily trends stay readable at a glance.
- Restyle Health with a compact 2×2 desktop grid and a swipeable mobile overview.
  Use dashboard-style controls, surface goal and sleep-stage summaries, and keep
  trends and recorded activities accessible through labeled tabs.

## 17 November 2026

**Add Google Health integration and dashboard**

- Clarify Health setup requirements for the callback URL, complete encryption
  key and backend restart so environment changes enable the connection.
- Keep the Health connection screen compact with a small page title, one
  connection card and concise status; remove promotional and repeated copy.
- Add a dedicated Health page with daily steps and a personal goal, recorded
  activity, sleep stages and seven-day trends, plus HRV and resting heart rate.
  Share recovery summaries with the existing AI coach for advice without
  automatically changing training plans.
- Connect Google Health v4 with read-only consent, encrypted server-side tokens,
  refresh and disconnect controls, account-bound OAuth, private cached summaries
  and partial-permission handling. Add database migration and Cloud setup guide;
  live access requires deployment credentials and Google authorization.

## 12 November 2026

**Screen coach output instead of user prompts**

- Remove the separate coach input-classification gate. Screen complete generated
  replies and tool batches before release or execution, retain whole-request
  refusals, and withhold output when screening is unavailable.

**Include chat history and proposals in coach topic screening**

- Include chat history and previously displayed workout proposals in coach topic
  screening so follow-up questions retain their meaning, with bounded context
  for long chats and the existing ownership and topic restrictions preserved.
- Screen tool-only coach steps in the context of the accepted request, retry
  uncertain output once before any tools run, and avoid asking users to clarify
  clear training requests when internal output screening is uncertain.
- Answer implicit training requests and general health questions directly with
  cautious, non-diagnostic guidance; retain coding, mixed-topic and role-override
  refusals. Render coach equations with accessible math in live and saved replies,
  and keep calculation results readable in plain text.
- Interpret short coach requests in their workout context and combine confidence
  across allowed topics to reduce unnecessary clarifications while retaining
  independent checks for unrelated tasks, coding and role overrides.
- Group changelog entries by the date changes were made and update repository
  instructions to use dated headings for future changes.

**Fix mobile profile photo and refresh Jern app icons**

- Show the signed-in Google profile photo in the mobile dashboard header, with
  an initial fallback when no photo is available or loading fails.
- Give Android install icons distinct Jern filenames so browsers can detect the
  new monogram instead of retaining icons cached before the rebrand.

**Fixed demo dashboard**

- Fix demo dashboard squeezing and overlapping controls by moving demo tools into
  the sidebar and hiding unavailable weight-entry controls.

**Rebranded to Jern**

- Refine the Jern identity with a shared geometric SVG monogram and bold wordmark
  across sidebar, mobile and sign-in, with theme-aware colors and matching app icons.
- Rebrand the app to Jern across desktop/mobile headers, sign-in, browser and
  install metadata, icons, API messages, coach prompts and topic policy, and docs.
  Keep existing database paths, session cookies and deployment service IDs for
  compatibility with saved data and running environments.

**Fix workout autosave revision conflicts**

- Retain acknowledged workout revisions when reopening the logger and coordinate
  background saves with autosave/finish so the client does not conflict with its
  own successful writes. Preserve revision checks against external changes.

**Allow coach capability and usage questions in Jev topic policy**

- Allow questions about the coach's capabilities, supported topics and usage by
  meaning, including contextual follow-ups after refusals; align Gemini's prompt
  and add evaluation cases while retaining coding and mixed-request restrictions.

**Add TypeSafe Jev topic guardrails for the AI coach**

- Remove temporary classifier terminal prints and the phone-preview category
  watcher after debugging; retain structured diagnostic file logging.
- Include the safe classifier failure reason in terminal debug output so a missing
  SDK or configuration issue can be distinguished from a topic classification.
- Show backend category output live in the phone-preview terminal instead of
  leaving redirected debug prints visible only in its log file.
- Print the detected Jev category to the backend terminal for debugging, without
  chat content or secrets; print `unavailable` when classification fails.
- Add independent TypeSafe Jev input/output topic checks before coach replies or
  model-directed tools are released, with clarification for uncertainty and logged
  degraded enforcement on technical failures (fail open).
- Buffer and screen generated tool arguments and conversation summaries; add
  backend-only classifier settings, policy tests and an optional synthetic live evaluation.

**Harden authentication, workout saves, and demo access**

- Ignore the root `AGENTS.md` file so repository instructions stay local.

## 1.0 — 11 November 2026

### Security fixes — 11 November 2026

These changes have been implemented and verified locally. Railway proxy
configuration and production deployment are pending.

### Versioning and maintenance

- Establish version 1.0 as the changelog baseline and set the package version to 1.0.0.
- Require a changelog update with every future repository change. Record changes
  under Unreleased until a version is assigned.

| Issue | What solved it |
| --- | --- |
| The next account could see the previous user's workout draft. | Drafts are stored per account. Ownership is verified before restoration, and old saves are stopped when accounts change. |
| A copied login cookie worked after logout. | Sessions are tracked in the database and revoked on logout, invalidating copied cookies. |
| An old autosave could overwrite a finished workout. | Workout revisions reject outdated saves. Draft saves cannot change completed workouts. |
| A coach proposal could run twice. | Confirmation and rejection compete for one atomic database transition, allowing one action to win. |
| Forged IP headers could bypass the demo rate limit. | Forwarding headers are accepted only from configured trusted proxies, and Nginx replaces visitor-supplied values. Railway's actual trusted addresses still require configuration. |
| Demo history became increasingly expensive to load. | History loads in pages, exercises and sets load in batches, and progress calculations use bounded queries. |
| A routine could be moved into another account's folder. | The API and database enforce folder ownership. The migration repairs existing invalid links while preserving routine contents. |
| Origin checks could trust a forged hostname. | Cookie-authenticated writes require an explicitly approved origin. Missing, hostile, and lookalike origins are rejected. |
| Dependencies had reported vulnerabilities. | Compatible patched versions were installed and locked. Both dependency audits passed. |

### Related reliability fixes

- Preserve acknowledged workout revisions during later edits and background saves.
- Keep unsynced local input available when a server revision conflict occurs,
  with an option to reload the saved workout.
- Advance workout revisions when moving completed workouts in the calendar.
- Offer a retry when server logout cannot be confirmed.
- Keep demo history search filters independent of dashboard activity.
- Load calendar workout details even when they fall outside the loaded history page.
- Preserve Unicode case-insensitive search and prevent duplicate history rows
  when loading more results.
- Add the real Nginx/Uvicorn security checks to CI.

### Upgrade notes

- Users must sign in again after upgrading.
- The legacy shared browser draft cache is removed because its owner cannot be
  established. Unsynced edits held only in that cache may be lost. Server-saved
  active workouts remain resumable.
- Database migration `0006_security_boundaries` is required. Back up the database
  and deploy the frontend and backend together.
- Demo charts describe loaded sessions. Session and volume totals cover the full
  filtered history. Demo exercise progress covers the latest 100 completed workouts.

### Verification

- 148 frontend tests passed.
- 92 backend tests passed in Linux/Python 3.12.
- Production builds and container configuration checks passed.
- Real Nginx/Uvicorn tests passed session revocation and forwarded-IP protections.
- Both dependency audits passed. Lint completed successfully with warnings.
- Real mobile devices and production release checks remain pending.

See the [security remediation report](docs/security-remediation.md) for migration,
proxy configuration, verification details, and recovery instructions.
