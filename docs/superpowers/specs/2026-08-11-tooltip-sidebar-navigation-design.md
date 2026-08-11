# Tooltip Sidebar Navigation Design

## Goal

Upgrade the React user workspace sidebar with compact circular navigation controls when it is collapsed. Hover or keyboard focus reveals a label extending into the content area. Navigation links, page routes, theme behavior, and the expanded-sidebar layout remain unchanged.

## Scope

- Update the non-home React user navigation in `frontend/src/shared/layouts/UserLayout.jsx`.
- Add scoped navigation styles in `frontend/src/shared/styles/global.css`.
- Extend the React architecture validator with navigation interaction contracts.
- Do not modify Express routes, legacy HTML pages, API calls, login behavior, or page content.

## Interaction

### Expanded Sidebar

- Keep the existing icon-and-label rows.
- Preserve the active-page marker and normal route links.

### Collapsed Sidebar

- Each navigation link has a stable 50px circular icon hit area.
- Hovering a link on a pointer device expands its label to the right of the icon.
- Keyboard focus produces the same visible label, so the interaction is not mouse-only.
- The active route remains visibly highlighted even without hover.
- The expanding label is part of the same link; clicking either surface navigates normally.

### Visual Treatment

- Use the supplied circular reveal concept, adapted to existing application colors and CSS variables.
- Limit the multicolor accent to the collapsed navigation interaction; it must not become a page-wide background or alter the working surfaces.
- Use an opaque backing surface and border so the control remains legible in both themes.
- Do not rotate semantic emoji navigation icons; motion is limited to the label reveal and a subtle control transition.

### Responsive and Accessible Behavior

- On viewport widths at or below 900px, retain icon-only navigation without a protruding label to prevent overlap with the work area.
- Keep the accessible link name from the existing label text.
- Provide `:focus-visible` styling.
- In `prefers-reduced-motion: reduce`, disable label transform and transition animation while leaving the focused/active label readable.

## Implementation Shape

`UserLayout` will add a decorative navigation-label surface inside each existing `Link`. CSS will show it only when `.legacy-sidebar.collapsed` and the link is hovered, focused, or active. Existing `.legacy-nav-label` remains the normal expanded-sidebar label.

## Validation

- Static architecture validator asserts the tooltip surface, collapsed selector, keyboard focus rule, reduced-motion rule, and responsive suppression.
- Build the React frontend.
- In the browser, verify collapsed hover/focus expansion, link navigation, active state, light theme contrast, and mobile-width behavior.

## Non-Goals

- No floating dock navigation.
- No new routes, persistence, API calls, libraries, or SVG icon replacements.
