# Mobile UX audit — final polish pass (2026-09-14)

Scope: visual/interaction polish of the existing, already-functional Mini App. No backend, API, or business-rule changes. Sourcing: Telegram's official Bot API / Mini Apps documentation (fetched live this session — see citations below); general, widely-documented mobile productivity-app conventions (Asana, Todoist, Linear, ClickUp mobile) from established product-design knowledge, since live screenshots of those apps are not fetchable from this environment. This is a working benchmark, not a design thesis — kept short on purpose.

## Telegram Mini App platform guidance (official docs)

Source: `core.telegram.org/bots/webapps`.

| Guidance | Adopt? | Why |
| - | - | - |
| Call `ready()` as soon as the essential UI is loaded; `expand()` to maximize height | Already done | Confirmed present in the auth effect; no change needed. |
| `viewportStableHeight` for pinning UI (not the gesture-time `viewportHeight`) | Adopt via CSS | Telegram's own script sets `--tg-viewport-stable-height` on `:root` automatically — used for panel `max-height` instead of a flat `92vh` so a sheet doesn't overshoot the space Telegram actually gives it. |
| `safeAreaInset` (device notch/home indicator) and `contentSafeAreaInset` (Telegram's own header/controls) | Adopt via CSS | The app already used `env(safe-area-inset-*)` for the device; it did not account for Telegram's own chrome. Telegram exposes both as CSS vars (`--tg-safe-area-inset-*`, `--tg-content-safe-area-inset-*`) with no JS needed. |
| `hideKeyboard()` (Bot API 9.1+) | Not adopted | Dismissing the keyboard programmatically on our own timeline (e.g. right after submit) is a nice-to-have, not a fix for the reported zoom bug, and forcing it on older clients that lack Bot API 9.1 has no graceful signal to detect support cheaply. Deferred as P3. |
| `HapticFeedback` (`notificationOccurred`, `impactOccurred`, `selectionChanged`) | Adopt, sparingly | Used only for: task created (success), checklist item toggled (selection), and a workflow action completing (impact) — not on every tap, per the spec's own caution. |
| `MainButton`/`BottomButton` for a form's primary action | Evaluated, not adopted this pass | See "Primary create action" below. |
| No official swipe/keyboard-height API beyond `viewportChanged`/`hideKeyboard()` | N/A | Confirms the correct fix for keyboard-covers-input is the visual-viewport-driven CSS approach below, not a Telegram-specific keyboard API. |

## General mobile productivity-app patterns (Asana / Todoist / Linear / ClickUp — established conventions)

| Pattern | Source app family | Adopt? | Why |
| - | - | - | - |
| Bottom nav: 4–5 flat destinations, short label + simple glyph, understated selected state (color change, not a pill/background block) | All four | Adopt (mostly already true) | Matches our existing Home/Tasks/Team/Reports nav; no new tabs added. |
| "Today"-first home, not a generic dashboard: a short greeting, then the few things that need action now, then a task list | Todoist, Linear | Adopt | Directly matches this pass's Home redesign goal; implemented by de-emphasizing zero-value stat tiles and keeping the task list as the dominant element. |
| Compact task rows: title first, one line of metadata (assignee/deadline), status as a small indicator not a large badge | Linear, Asana | Adopt (mostly already true) | Existing `TaskCard` was already close to this; tightened priority/status visual weight. |
| Person picker as a full-row-tappable bottom sheet (avatar/initial + name + role), not a native `<select>` | Asana, ClickUp | Adopt | Replaces the Quick Add assignee `<select>` and the two other person-selecting `<select>` elements with one shared, reused sheet component. |
| Progressive disclosure on quick-create: title + assignee + due date visible, priority/description/recurrence behind "More" | Todoist, Asana | Already true | Confirmed already implemented (`<details>` "More options" in Quick Add) — preserved, not rebuilt. |
| Relative, human date labels ("Today", "Tomorrow", then an absolute date) while the stored value stays an exact timestamp | Todoist, Things | Adopt | Added as a read-only summary line under the deadline input; the underlying `datetime-local` control and stored ISO value are unchanged. |
| One primary action per screen state, secondary actions visually quieter, rare actions behind a menu | Linear | Adopt (mostly already true) | Task Detail and Team already lean this way; confirmed rather than rebuilt given the size of this pass. |
| Dark mode follows the host app's theme, not a fixed light palette | All four (as native apps under OS dark mode) | Adopt | Telegram Mini Apps are not reliably covered by `prefers-color-scheme` alone — a Telegram client can run its own dark theme independent of the OS. Wired `Telegram.WebApp.colorScheme`/`themeChanged` to a `data-theme` attribute, with a `prefers-color-scheme` fallback for a plain-browser session. |

## Telegram Mini App viewport/keyboard specifics tested against this codebase

1. iOS/WebView automatic input-focus zoom (A) — **not applicable as a separate cause**; it's the *mechanism*, not an independent bug. WebKit (including Telegram's in-app browser on iOS, which is WKWebView-based) zooms the page on focusing any form control whose *effective* font-size is under 16px, regardless of viewport meta content, and there is no viewport-meta setting that suppresses this other than the explicitly-forbidden `user-scalable=no`/`maximum-scale=1`.
2. Incorrect viewport meta (B) — **ruled out**. `src/app/layout.tsx`'s `viewport` export already produces `width=device-width, initial-scale=1, viewport-fit=cover` with no `maximum-scale` or `user-scalable=no`. Nothing to fix here; it was already correct.
3. Telegram Mini App collapsing/expanding (C) — **ruled out as the cause of the zoom**, though `expand()` is already called on auth so the app isn't fighting a collapsed viewport during use.
4. Virtual keyboard resizing the visual viewport (D) — expected, normal behavior; not itself a bug. The `.ma-panel` bottom-sheet pattern already scrolls internally, so a shrinking visual viewport does not clip content — it just means less of the sheet is visible above the keyboard, which the user can scroll.
5. Fixed/sticky elements fighting the keyboard (E) — the bottom nav (`position: fixed`) and panel header (`position: sticky` inside its own scroll container) do not conflict with the keyboard in practice, because every form (Quick Add, deadline request, recurrence) is rendered inside the `.ma-overlay`/`.ma-panel` sheet, which already sits above the bottom nav (`z-index: 100` vs. `20`) and fully occludes it. No separate fix needed here.
6. `transform`/`scale` on a parent (F) — **ruled out**; grepped the stylesheet, no `transform: scale(...)` is applied to any form ancestor.
7. **Form control font-size too small (G) — confirmed root cause.** `.ma-form-group input/textarea/select` and `.ma-block-form input/textarea/select` were set to `font-size: 0.9rem` (14.4px at the default 16px root), below WebKit's 16px auto-zoom threshold. Every text input, textarea, select, and date/time control in the app goes through one of these two selectors, so this single rule change is a complete, not partial, fix.
8. `scrollIntoView`/focus logic (H) — no custom focus-management code exists in the app; the browser's native focus-scroll behavior applies, which works correctly once (7) is fixed (the zoom itself was what made the native behavior feel broken — with no zoom, the native scroll-into-view is unremarkable).
9. Other WebView issue (I) — none found.

**Conclusion**: the reported "viewport zoom/change" on focusing an input is (G), a single CSS defect, not a Telegram platform limitation, a viewport-meta misconfiguration, or a JS focus-handling bug. Fixed by raising the two shared form-control rules to `16px` — see `docs/MVP_AUDIT.md` "Update — 2026-09-14: final UI/UX polish pass" for the exact diff and regression risk.
