# BattleShip vanilla web regression checklist

Scope: the vanilla web port only. Run this checklist against the exact artifact
being proposed as the playable baseline; do not mix files from different web
build directories. Record browser/version, artifact name, commit, controller,
display resolution, and whether that artifact is expected to contain audio.

## Clean-start precondition

- Start once in a fresh browser profile or after clearing the site's storage.
- Leave `gEnhancements.BootToVSCSS` disabled. Its default is disabled.
- Confirm there are no uncaught exceptions or WebAssembly traps in Diagnóstico.

## Original boot flow

- [ ] A fresh load enters the original opening-room/intro flow, not VS CSS.
- [ ] The intro advances to the title screen without a black frame or hang.
- [ ] Start reaches the title menu; VS Mode reaches VS character select.
- [ ] Back navigation returns through the original menus.
- [ ] Reload repeats the original flow unless `Boot to VS CSS` is explicitly
      enabled.
- [ ] Diagnostic opt-in: enabling `Boot to VS CSS`, reloading, and then
      disabling it still works and restores the original flow on the next load.

## Complete-match smoke test

- [ ] The Raphnet/Gamepad connection notice identifies the active controller.
- [ ] Stick, A, B, Start, Z, L/R, D-pad, and C buttons respond correctly.
- [ ] Select two fighters and an original VS stage through the normal menus.
- [ ] Play until the normal stock/time match end; no render freeze or wasm trap.
- [ ] Fighters, stage, HUD, effects, pause screen, and animations remain visible.
- [ ] Results render and the normal return path reaches character select.
- [ ] Start a second match with different fighters and a different original
      stage to catch stale display-list/segment state.
- [ ] Secret fighters, Mushroom Kingdom, Sound Test, and Item Switch remain
      unlocked in the web build.
- [ ] If audio is expected in the tested artifact: enable it through a browser
      gesture, verify menu/match/results audio, and verify it remains synchronized.
- [ ] If audio is intentionally absent: record `N/A (silent baseline)` instead
      of treating silence as a regression in this graphics-only artifact.

## Fullscreen and resize

- [ ] Enter fullscreen from character select; the complete 4:3 frame is centered.
- [ ] Play for at least 30 seconds fullscreen; controls and frame pacing remain
      stable and the 1280x960 WebGL backing buffer is not visibly stretched.
- [ ] Exit with Escape; the complete frame returns centered with no black or
      oversized region and the button again reads `Pantalla completa`.
- [ ] Repeat enter/exit during a match and on the results screen.
- [ ] Resize the normal browser window narrower, shorter, then larger; no part
      of the game frame is clipped and the aspect ratio stays 4:3.
- [ ] If audio is expected: fullscreen transitions do not replay stale audio,
      slow it down, or leave it distorted.

## Minimize, background, and restore

- [ ] During character select, minimize the window for 10 seconds and restore;
      the frame redraws, input resumes, and no button remains latched.
- [ ] During a match, release all controls, minimize for 10 seconds, and restore;
      gameplay/rendering resumes without a black frame or crash.
- [ ] Switch tabs for 10 seconds and return; canvas size and controller status
      recover without reloading.
- [ ] Repeat minimize/restore once after leaving fullscreen.
- [ ] If audio is expected: no old queued sound plays after restore and current
      sound remains synchronized.
- [ ] Diagnóstico contains no new WebAssembly trap, worker exhaustion, WebGL
      context loss, or repeated display-list error caused by the transition.

## Persistence and acceptance

- [ ] Trigger a save-changing action, wait for `Partida guardada`, reload, and
      confirm `Partida restaurada` without losing unlocks.
- [ ] Complete two consecutive matches after at least one fullscreen cycle and
      one minimize/restore cycle.
- [ ] Acceptance requires every applicable item above to pass twice in the
      target physical browser. Attach a screenshot and diagnostic excerpt for
      each failure, including the exact scene and reproduction sequence.
