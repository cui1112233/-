# Tooltip Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accessible circular tooltip navigation to the collapsed React user sidebar without changing existing routes or expanded navigation.

**Architecture:** Keep each existing `Link` as the click owner. Add a decorative tooltip span inside the link and reveal it only through collapsed-sidebar CSS selectors for hover, visible keyboard focus, and the active route. The existing label remains the accessible name and the expanded-sidebar label.

**Tech Stack:** React 18, CSS, existing Link component, Node `assert` architecture validator.

---

## File Structure

- `frontend/src/shared/layouts/UserLayout.jsx`: owns the navigation markup and adds the decorative tooltip span inside every existing link.
- `frontend/src/shared/styles/global.css`: owns collapsed navigation geometry, hover/focus/active states, theme-safe colors, reduced-motion behavior, and mobile suppression.
- `scripts/validate-react-frontend-architecture.js`: guards the sidebar tooltip markup and CSS contracts.

### Task 1: Lock the Tooltip Navigation Contract

**Files:**
- Modify: `scripts/validate-react-frontend-architecture.js:49-75`

- [ ] **Step 1: Write the failing contract assertions after the existing user-layout navigation assertions**

```js
assert(userLayout.includes('legacy-nav-tooltip'), 'user navigation should render tooltip labels for collapsed links');
assert(userLayout.includes('aria-hidden="true"'), 'navigation tooltip labels should remain decorative');
assert(globalCss.includes('.legacy-sidebar.collapsed .legacy-nav-tooltip'), 'global CSS should style collapsed navigation tooltip labels');
assert(globalCss.includes('.legacy-sidebar.collapsed .legacy-nav a:focus-visible .legacy-nav-tooltip'), 'collapsed navigation tooltip should be visible for keyboard focus');
assert(globalCss.includes('@media (prefers-reduced-motion: reduce)'), 'global CSS should respect reduced motion for navigation tooltip labels');
assert(globalCss.includes('@media (max-width: 900px)'), 'global CSS should define the compact navigation breakpoint');
```

- [ ] **Step 2: Run the validator to prove the new contract is red**

Run: `node scripts/validate-react-frontend-architecture.js`

Expected: exits with an assertion beginning `user navigation should render tooltip labels for collapsed links`.

- [ ] **Step 3: Leave the red contract unstaged until the production implementation is ready**

Run: `git diff -- scripts/validate-react-frontend-architecture.js`

Expected: only the six tooltip navigation contract assertions are shown.

### Task 2: Add Tooltip Markup and Collapsed Navigation Styles

**Files:**
- Modify: `frontend/src/shared/layouts/UserLayout.jsx:93-100`
- Modify: `frontend/src/shared/styles/global.css:142-204`
- Test: `scripts/validate-react-frontend-architecture.js`

- [ ] **Step 1: Add a decorative tooltip span to every navigation link**

Replace the current link children with:

```jsx
<span className="legacy-nav-icon">{item.icon}</span>
<span className="legacy-nav-label">{item.label}</span>
<span className="legacy-nav-tooltip" aria-hidden="true">{item.label}</span>
```

The label stays in the DOM for the link's accessible name. The tooltip is only a visual duplicate.

- [ ] **Step 2: Add the collapsed-only circular control and tooltip rules**

Add the following selectors near the existing `.legacy-sidebar.collapsed` and `.legacy-nav` rules:

```css
.legacy-sidebar.collapsed .legacy-nav a {
  position: relative;
  width: 50px;
  min-height: 50px;
  padding: 0;
  justify-content: center;
  overflow: visible;
  border-radius: 50%;
}

.legacy-sidebar.collapsed .legacy-nav-icon {
  position: relative;
  z-index: 2;
  width: 50px;
  min-width: 50px;
  height: 50px;
  border: 1px solid var(--legacy-border-strong);
  border-radius: 50%;
  background: var(--legacy-card);
  box-shadow: var(--legacy-shadow);
}

.legacy-sidebar.collapsed .legacy-nav-tooltip {
  position: absolute;
  z-index: 1;
  left: 25px;
  display: flex;
  align-items: center;
  width: max-content;
  min-width: 132px;
  height: 50px;
  padding: 0 16px 0 42px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0 25px 25px 0;
  color: #fff;
  background: linear-gradient(110deg, #f07067, #d65386 50%, #5a8ed0);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.18);
  opacity: 0;
  pointer-events: auto;
  transform: scaleX(0.35);
  transform-origin: left center;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.legacy-sidebar.collapsed .legacy-nav a:hover .legacy-nav-tooltip,
.legacy-sidebar.collapsed .legacy-nav a:focus-visible .legacy-nav-tooltip,
.legacy-sidebar.collapsed .legacy-nav a.active .legacy-nav-tooltip {
  opacity: 1;
  transform: scaleX(1);
}

.legacy-sidebar.collapsed .legacy-nav a.active .legacy-nav-icon {
  color: #fff;
  background: linear-gradient(110deg, #f07067, #d65386 50%, #5a8ed0);
}

.legacy-sidebar.collapsed .legacy-nav a:focus-visible {
  outline: 2px solid var(--legacy-accent);
  outline-offset: 3px;
}
```

- [ ] **Step 3: Add compact-screen and reduced-motion guards**

```css
@media (max-width: 900px) {
  .legacy-sidebar.collapsed .legacy-nav-tooltip {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .legacy-sidebar.collapsed .legacy-nav-tooltip {
    transition: none;
    transform: none;
  }
}
```

- [ ] **Step 4: Run the validator to prove the contract is green**

Run: `node scripts/validate-react-frontend-architecture.js`

Expected: `React frontend architecture validation passed.`

- [ ] **Step 5: Build and inspect scoped changes**

Run: `npm --prefix frontend run build && git diff --check`

Expected: exit code `0`; Vite bundle-size guidance is allowed.

- [ ] **Step 6: Verify in the browser**

1. Open `http://127.0.0.1:3000/script`.
2. Select `收起导航`.
3. Hover `剧本生成`; confirm the label expands to the right and clicking it keeps the route working.
4. Use `Tab` until a navigation link is focused; confirm the same label is visible.
5. Toggle the light theme; confirm icon, label, border, and active state remain legible.
6. At a viewport width below 900px, confirm no label overlaps the workbench.

- [ ] **Step 7: Commit only the tooltip-navigation files**

Because `UserLayout.jsx` and `global.css` already contain unrelated working-tree edits, stage only the new tooltip markup, scoped navigation CSS, and validator assertions. Do not stage pet, theme, or page-layout edits.

Run: `git diff --cached --check && git commit -m "feat: add collapsed navigation tooltips"`

Expected: the commit changes only `UserLayout.jsx`, `global.css`, and `validate-react-frontend-architecture.js`.

## Plan Review

- Spec coverage: Task 2 preserves expanded links, provides collapsed hover/focus/active states, protects mobile and reduced-motion behavior, and keeps the tooltip decorative. Task 1 prevents regressions.
- Scope: no backend, legacy-page, route, API, or dependency changes are included.
- Consistency: the tooltip class, selectors, breakpoint, and validation strings use the same names in all tasks.
