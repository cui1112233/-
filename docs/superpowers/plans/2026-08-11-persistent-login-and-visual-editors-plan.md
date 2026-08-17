# Persistent Login And Visual Editors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure persistent sessions and visual-first script, character, and scene editing.

**Architecture:** Server-owned persistent sessions keep an opaque token and expiry. The React script page owns editable output and extracted entities; a visual editor normalizes arbitrary entity data into Chinese fields and shares a resizable object pane.

**Tech Stack:** Express, React 18, Ant Design, Node built-in test runner.

---

### Task 1: Persistent session contract

- [ ] Write a failing session-expiry test.
- [ ] Add persistent session helpers and login/logout API behavior.
- [ ] Verify session tests and server syntax.

### Task 2: Script editing contract

- [ ] Write failing tests for visual entity-field normalization.
- [ ] Add editable output and visual entity editor components.
- [ ] Verify component helper tests and frontend build.

### Task 3: Workbench and navigation integration

- [ ] Connect shared panel resizing, fullscreen editing, and left-bottom tools.
- [ ] Run integration syntax, build, and endpoint checks.
