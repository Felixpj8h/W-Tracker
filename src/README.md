# Source layout

```text
src/
  main.tsx             React entry point and browser bootstrap
  app/                 App shell, page composition, and app integration tests
  features/
    auth/              Authentication headers and session profile helpers
    coach/             Coach UI, controller, API, types, and tests
    history/           History analysis UI, styles, and tests
  styles/              Global styles and styles for pages composed in App
  types/               Ambient browser and third-party type declarations
  assets/              Images and other bundled static assets
```

Keep a feature's components, hooks, helpers, types, tests, and styles together.
Use `*.test.ts` or `*.test.tsx` beside the module they cover. Cross-feature page
composition belongs in `app/`; application-wide styles belong in `styles/`.
Use direct imports so dependencies are easy to follow.

Several dashboard, routine, workout, and calendar components currently live in
`app/App.tsx`. When extracting them, create the corresponding folder under
`features/` and move their dedicated styles and tests alongside them. Shared
styles should stay in `styles/`, and CSS import order should be preserved because
later styles override earlier ones.
