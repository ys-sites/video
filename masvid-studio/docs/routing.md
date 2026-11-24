# Studio Routing and Lazy-Loading Architecture

This guide defines how OpenMotion Studio organizes workspace pages, semantic path URLs, React Router integration, code splitting, SPA fallback prefixes, and shell dependency boundaries. Follow these rules whenever adding, moving, or modifying a Studio page.

## Directory ownership

All workspace route registration, Data Router wiring, and lazy surface management live under `studio/src/router/` and `shared/spa-routes.ts`:

- `shared/spa-routes.ts` — Shared allowlist of Studio SPA route prefixes (`SPA_ROUTE_PREFIXES`, `STANDALONE_SPA_PREFIXES`) and reserved backend/cloud prefixes (`RESERVED_BACKEND_PREFIXES`). Consumed by `editor-server.ts`, `server.ts`, `studio/vite.dev.config.ts`, `phase1.ts`, `scripts/check-routing.ts`, and Studio routing helpers so local HTTP fallback and client routes never drift.
- `studio/src/router/createAppRouter.tsx` — React Router Data Router factory (`createAppRouteObjects`, `createAppRouter`, `StudioRouterProvider`) mounted at the root of `studio/src/main.tsx`. Connects `workspaceHistory` to the active router via `location.state` and router-managed history indices (`history.state.idx`), with `createMemoryRouter` support for deterministic unit tests and StrictMode-safe lifecycle handling.
- `studio/src/router/LegacyQueryRedirect.tsx` — Mounted on the root `/` index route to transparently `replace` legacy `/?page=...`, bare `/`, and `/?project=...#project/...` bookmarks onto their canonical semantic paths while preserving orthogonal query parameters (`embed`, `hostChrome`, `templates`, `template`, `project`, `session`, `tracking_context`) and `#project/...` hashes without adding an extra history entry.
- `studio/src/router/lazyPages.ts` — Single source of truth for lazy-loaded workspace page and overlay components (`lazyWithChunkReload`), `LAZY_PAGE_MODULE_PATHS`, and intent-based prefetch helpers (`preloadWorkspacePage`, `preloadStudioRoute`).
- `studio/src/router/routeRegistry.ts` — Declarative route table (`workspaceRouteRegistry`) defining route IDs, match precedence, `keepAlive` policy, standalone flags, tracking page names, and arrival tracking helpers.
- `studio/src/router/KeepAliveOutlet.tsx` — `useKeepAliveVisited` and `KeepAliveSlot` driven directly by `workspaceRouteRegistry.keepAlive`. KeepAlive routes stay mounted once visited (`hidden` + `aria-hidden` + `inert`); all other routes unmount immediately when inactive.
- `studio/src/router/useWorkspaceBlocker.ts` — React Router `useBlocker`-powered navigation guard for browser history traversal (`POP`) across projects or leaving a busy template library. Preserves Forward/Back history cleanly via `blocker.proceed()` / `blocker.reset()`.
- `studio/src/router/RouteViewport.tsx` — Renders the active workspace surface and KeepAlive slots inside a single always-mounted `<Suspense>` boundary (with per-route `SettingsSurfaceBoundary` error isolation). Keeping `<Suspense>` always mounted allows `WorkspaceFrame`'s `useTransition` to hold the currently visible page painted while the next lazy chunk resolves, eliminating blank screens and skeleton flashes during in-app navigation.
- `studio/src/router/OverlayLayer.tsx` — Renders cross-cutting overlays (template library dialog and standalone card preview) inside an always-mounted `<Suspense fallback={null}>` without coupling them into `WorkspaceFrame.tsx`.

`studio/src/motion/WorkspaceFrame.tsx` is strictly the **App Shell** (header, project sidebar, chrome context, toasts, and keyboard shortcuts). Never import feature pages statically into `WorkspaceFrame.tsx` or `studio/src/main.tsx`.

## Canonical URL contract

Every workspace destination has a canonical semantic pathname. Do not add new `/?page=...` query destinations.

| Surface | Canonical URL | Notes |
| --- | --- | --- |
| Explore | `/explore` (filters in `?community=...&medium=...`) | Bare `/` redirects here via `LegacyQueryRedirect`; `/explore/:community` is also accepted on direct load. |
| Motion Studio | `/motion` | Motion Studio landing & template catalog. |
| Focused media generator | `/create/:scene` (optional `?model=...&skill=...&cinemaTemplate=...`) | Unified image/video landing generator (`text-to-image`, `image-edit`, `text-to-video`, `image-to-video`, etc.). |
| Cinema Studio | `/cinema` · `/cinema/:scene` | Cinema Studio landing and scene generator. |
| Design Studio | `/design/:scene` · `/design/projects/:id` | HTML Design Studio scenes (`prototype`, `deck`, `document`, `web-clone`, `projects`) and project editor. Legacy Design image links rewrite to `/create/:scene`. |
| Sound Studio & Audio tab | `/sound` · `/sound/:tab` · `/audio/:tab` | `/sound` opens Sound Studio home; `/sound/:tab` opens Sound Studio workbench; `/audio/:tab` opens the top-level Audio tab. |
| Specialty studios | `/studios/:studioId` · `/studios/:studioId/:scene` | Covers `shorts`, `marketing`, `explainer`, `3d`, and `game` (with optional `?skill=...` or `?game=...`). |
| Workflows / Scenarios | `/scenarios` · `/scenarios/:id` | Scenario hub (`?category=...`) and workspace (`?run=...&step=...&mode=agent`). |
| Skills library | `/skills` · `/skills/:id` | Optional `?category=...`. |
| Models & Model Hubs | `/models/:id` · `/model-hub/:id` | Provider-qualified model IDs are URL-encoded in `:id`. |
| Workspace assets | `/assets` · `/assets/:id` | Optional `?version=...` on `/assets/:id`. |
| Brand Kit | `/brand-kit` · `/brand-kit/:id` | Official collection, `mine`, `new`, or a saved kit ID. |
| Settings center | `/settings/:section` (including `/settings/mcp`) | Optional `?provider=...` on `/settings/providers` and `?entry_from=...` while inside Settings. |
| Standalone MCP setup | `/mcp-setup` · `/mcp-setup/:client` | Optional `?host=...&setup=manual&example=...`. Uses `/mcp-setup` because `/mcp` is reserved for the cloud Streamable HTTP MCP protocol endpoint. |
| Motion Editor | `/editor/:projectId?session=...#project/:projectId?...` · `/editor` | Preserves `#project/<id>?v=&t=&tab=...` synchronized with the upstream timeline player. |

### Orthogonal query parameters and legacy compatibility

- **Cross-page overlays and host embeds** remain orthogonal query parameters that compose cleanly on top of any canonical path: `?templates=1`, `?collection=...`, `?view=creators`, `?creator=...`, `?template=...`, `?embed=1`, `?hostChrome=1`, `?tracking_context=...`. Root template/embed links (`/?templates=1&embed=1`, `/?hostChrome=1`) intentionally stay at `/` without redirecting.
- **Legacy bookmarks** (`/?page=...`, bare `/`, `/?project=...#project/...`, `/#project/...`, `/?session=...`) are transparently redirected in place via `LegacyQueryRedirect.tsx` (`replace`), preserving all orthogonal query parameters and `#project/...` hashes.

## Rules for adding or modifying a page

1. **Register lazily via `lazyWithChunkReload`.** Add every new workspace page to `studio/src/router/lazyPages.ts` (including `LAZY_PAGE_MODULE_PATHS`) and mount it through `RouteViewport.tsx` (or `OverlayLayer.tsx` for cross-page overlays). Do not statically import page modules from `WorkspaceFrame.tsx`, `ApplicationChrome.tsx`, or `WorkspaceBreadcrumb.tsx`.
2. **Keep route metadata, SPA prefixes, and Data Router leaves in sync.** When adding a top-level route, update `studio/src/router/routeRegistry.ts`, `studio/src/router/createAppRouter.tsx`, and `shared/spa-routes.ts` together, and emit semantic paths from `workspacePageRouting.ts` instead of introducing new `?page=` parameters.
3. **Extract lightweight metadata before sharing across shell and pages.** If the shell (breadcrumbs, header menus, search) needs labels or constants from a lazy page, place those pure constants in a tiny metadata module (for example `studio/src/motion/settingsMeta.ts`) instead of importing the page component file.
4. **Keep the shell free of heavy editor parsers and raw locale JSON.** Never import `@hyperframes/parsers` (barrel entry), `studio/src/utils/sourcePatcher.ts`, `studio/src/utils/studioHelpers.ts`, `studio/src/i18n/*.json`, or `studio/src/i18n/sourceCatalog.ts` from shell-reachable modules. Both `scripts/check-routing.ts` (run by `npm run check`) and `studio/src/shellBoundary.test.ts` enforce this boundary in CI and report the exact offending import chain.
5. **KeepAlive allowlist.** Only `editor`, `explore`, and `assets` stay mounted once visited (`hidden` + `aria-hidden` + `inert`) via `KeepAliveSlot`. All other studios unmount when navigated away; preserve user drafts in lightweight in-memory maps (such as `studioDrafts`) rather than expanding KeepAlive without a clear UX requirement.
6. **Reserved backend and cloud prefixes.** Never claim backend or cloud protocol prefixes in `SPA_ROUTE_PREFIXES` or client routes (`scripts/check-routing.ts` and `tests/spa-routes.test.ts` fail CI on any exact, parent, or child prefix collision):
   - `/api`, `/motion-api`, `/design-api`
   - `/mcp` (reserved for cloud Streamable HTTP MCP endpoint; use `/mcp-setup` for frontend MCP pages)
   - `/mcp-ui`, `/connect`, `/sessions`
   - `/editor-assets`, `/guide-assets`, `/design-system`, `/web`
   - `/.well-known`, `/__hyperframes_config`
7. **Root-relative asset paths.** `studio/vite.config.ts` pins `base: '/'`. Keep all HTML, CSS, font, and fetch URLs root-relative (`/...`) rather than relative (`./...`) so nested path routes resolve assets identically.
8. **Shared vs. route-scoped stylesheets.** Cross-page workspace host stylesheets (`studio/src/motion/skills.css`, `sceneDiscovery.css`, `assets.css`) are imported eagerly in `studio/src/main.tsx` ahead of `studio.css` and `application.css` so every lazy route gets identical layout and cascade order on cold direct load. Keep page-specific CSS strictly prefixed to that page and import it in the page module itself.

## Verification checklist

When touching Studio routes, SPA fallback prefixes, or shell imports:

- Run `npm run check` (executes `scripts/check-routing.ts` and `scripts/check-i18n.ts`), `npm run typecheck:studio`, `npm run typecheck:backend`, `npm run test:studio`, and `npm run build:studio`.
- Run backend SPA fallback & handoff tests: `node --experimental-strip-types --test tests/spa-routes.test.ts tests/server.test.ts tests/preview-handoff.test.ts`.
- Confirm `studio/src/shellBoundary.test.ts` and `studio/src/router/appRouter.test.tsx` pass without weakening any boundary assertions.
- Inspect `studio/build/editor-assets/` to verify new pages emit their own async chunks rather than expanding `index-*.js`.
