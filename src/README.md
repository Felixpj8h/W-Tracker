# Source layout

```text
src/
  main.tsx             React entry point and browser bootstrap
  app/                 App shell, navigation, and cross-feature page composition
  features/
    auth/              Sign-in gate, authentication headers, profile, and styles
    calendar/          Training calendar, weekly planning, and workout dialogs
    coach/             Coach UI, controller, API, types, and tests
    dashboard/         Overview, bodyweight charts, muscle map, styles, and tests
    exercises/         Exercise types and muscle-label helpers
    history/           Session history and analysis, styles, and tests
    routines/          Routine folders, workout day editor, rest fields, and styles
    workout/           Workout logger, active-session helpers, types, and styles
  shared/
    api/               Authenticated tracker API and backend write tracking
    lib/               Date, time, and volume formatting helpers
    ui/                Page header, saving indicator, and reusable display components
  styles/              Shared base, motion, mobile, and typography styles
  types/               Ambient browser and third-party type declarations
  assets/              Images and other bundled static assets
```

Keep a feature's components, hooks, helpers, types, tests, and styles together.
Use `*.test.ts` or `*.test.tsx` beside the module they cover. Cross-feature page
composition belongs in `app/`; application-wide styles belong in `styles/`.
Use direct imports so dependencies are easy to follow.

`app/App.tsx` connects the authentication gate to `app/WorkoutApp.tsx`, which owns
navigation and coordinates data shared by multiple pages. Feature modules should
not import the app shell. Shared domain types live in the feature that owns them;
other features import those types directly.

Dedicated feature styles live beside their components. `app/styles.ts` imports
the shared and feature styles in their established order because later rules
override earlier ones. `styles/base.css` contains the existing shared theme,
layout, and legacy cross-feature rules; keep cascade changes separate from file
organization. Dashboard touch handling lives in `features/dashboard/touch.ts`
and is registered by `main.tsx` at browser bootstrap.
