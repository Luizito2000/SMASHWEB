# BattleShip Web port status

Scope: BattleShip vanilla (US). No Smash Remix content or code is included.

## Current milestone

The vanilla game configures, compiles, links, loads its generated O2R assets,
creates a WebGL 2 context, synthesizes stereo audio, and renders visible N64
graphics in a browser. A controlled browser test reaches the character-select
screen with a 1280x960 backing buffer. The visible canvas scales responsively
while retaining the original 4:3 aspect ratio and fits against both browser
dimensions, so the complete game frame remains visible without scrolling.
Audio is enabled by default and resumes from a browser gesture when autoplay
policy requires it.

The web build polls up to four standard browser gamepads without invoking SDL's
blocking startup enumeration. Raphnet N64 HID layouts receive a dedicated
mapping. The standard browser Gamepad path has been validated by the user with
a connected Raphnet adapter and original N64 controller. The optional raw
WebHID permission/report path remains experimental and is disabled by default.

The full 32 KiB SRAM image is restored from and persisted to browser local
storage. The page displays controller and save-state notices, keeps them inside
the fullscreen element, and hides the verbose Emscripten console behind a
`Diagnóstico` button.

The latest graphics-recovery output is:

- `build-web-audio/BattleShipGraphicsRecovery.html`
- `build-web-audio/BattleShipGraphicsRecovery.js`
- `build-web-audio/BattleShipGraphicsRecovery.wasm`
- `build-web-audio/BattleShipGraphicsRecovery.data`

This recovery build deliberately compiles the experimental web synthesis fiber
out (`SSB64_WEB_AUDIO=OFF`). It is the current playable baseline while audio is
moved to an isolated browser-main-loop path.

The source ROM is used locally to generate `BattleShip.o2r`; it is not embedded
in or copied into the browser output.

## Build and run

Place a legally obtained US ROM at the repository root using one of these
names: `baserom.us.z64`, `baserom.us.n64`, or `baserom.us.v64`.

With Emscripten activated:

```sh
embuilder build zlib
cmake --preset web-debug
cmake --build --preset web-debug
python tools/serve_web.py --directory build-web --port 8000
```

Open `http://localhost:8000/BattleShip.html`. The included server supplies the
COOP/COEP headers required by WebAssembly threads and disables browser caching
for local iteration.

During the current side-by-side development session, the validated audio/save
build is served with:

```sh
python tools/serve_web.py --directory build-web-audio --port 8011
```

Open `http://localhost:8011/BattleShipGraphicsRecovery.html`.

For a short automated visual check, append `?snapshot=1`; that mode pauses the
browser loop after frame 20.

## Solved blockers

1. Added an Emscripten target using SDL2, WebGL 2, pthreads, memory growth, and
   Asyncify.
2. Added a web fiber/coroutine backend because POSIX `ucontext` is unavailable.
3. Disabled or stubbed native-only updater, Discord, hooking, RenderDoc,
   watchdog, native HID, and related desktop services only for the web target.
4. Deferred controller startup so it does not block the browser main loop.
5. Fixed a C/C++ `OSMesg` ABI mismatch that produced invalid scheduler tasks
   and stack corruption on wasm32.
6. Created the SDL canvas with a 1280x960 backing buffer, responsive 4:3 CSS,
   and explicitly requested an OpenGL ES 3 / WebGL 2 context.
7. Fixed drawable-size detection: SDL reported 0x0 in the browser even though
   the canvas had a valid backing size, causing a permanently black swapchain.
8. Bypassed the desktop ImGui draw path for the first-frame web milestone; its
   docking state and shader setup assumed the desktop backend.
9. Fixed strict WebAssembly function-signature mismatches in
   `itMainSetFighterRelease`, `syRdpSetViewport`, and `osVirtualToPhysical`.
10. Sized the web worker pool to the twelve long-lived workers created during
    startup. This avoids both the original oversized 32-worker pool and the
    exhausted 8-worker pool that could create workers late and stall a tab.
11. Added non-blocking Web Gamepad polling, including the known Raphnet N64 HID
    button order, plus an opt-in WebHID raw-SI bridge for direct controller
    status bytes.
12. Constrained the responsive 4:3 canvas against both viewport dimensions so
    the high-resolution backing buffer no longer pushes half the frame below
    the visible browser area.
13. Replaced Emscripten's stock fullscreen resize/reparent path with a
    BattleShip-specific canvas fullscreen path. The WebGL backing buffer stays
    at 1280x960, while CSS is recalculated after entering and leaving
    fullscreen so the image remains visible and correctly framed.
14. Made canvas fitting resilient to minimize/restore, tab visibility, focus,
    orientation, and transient zero-size browser viewports. Normal-flow styles
    are restored before measuring after fullscreen so subsequent resizes keep
    the complete 4:3 frame centered.
15. Fullscreen now uses a centered flex host and pins the WebGL drawing buffer
    to 1280x960. This prevents SDL from enlarging the backing buffer while the
    renderer keeps a 1280x960 viewport, which previously left the game in the
    upper-left with an oversized black area.
16. Added synchronous web audio-asset extraction and a non-blocking WebAudio
    bridge. Browser autoplay state is reflected by the `Activar sonido` /
    `Sonido activado` control.
17. Added browser-local SRAM persistence with visible `Partida restaurada` and
    `Partida guardada` state.
18. Replaced unsupported Fast3D web debug aborts with one-time diagnostics and
    implemented RGBA and texture-coordinate `G_MODIFYVTX` mutations.
19. Hid the large development log by default while retaining it behind a
    `Diagnóstico` button.
20. Restored the per-frame Fast3D segment-table reset. Retaining segment
    pointers between browser frames made fighter and stage display lists
    resolve to stale data; a controlled two-player match now renders Kirby,
    Pikachu, the stage, HUD, and animations correctly.
21. The web build enables all original unlocks by default: the four secret
    fighters, Mushroom Kingdom, Sound Test, and Item Switch. This overlays
    existing browser saves without changing the original desktop behavior.
22. The web random-stage pool excludes the port-only Final Destination, Metal
    Cavern, and Battlefield experiments. Original VS stages and Mushroom
    Kingdom remain available; the extra page is retained internally only so
    it cannot disturb the original decomp memory layout.
23. WebAudio now creates its output context at the device rate while retaining
    N64 PCM blocks at 32 kHz. It does not schedule audio while browser autoplay
    is blocked, limits the live queue to 80 ms, and clears its scheduled tail
    when sound is enabled or fullscreen changes. This prevents old menu audio
    from playing during a match and avoids the slow, raspy fullscreen tail.
24. Preserved `BattleShipWeb7` as the pre-audio reference and compared its wasm
    symbols with the regressed build. `syAudioThreadMain` grew from 587 bytes to
    7,713 bytes and became a very large Asyncify coroutine even when `audio=0`
    selected its runtime-disabled branch. A build-time `SSB64_WEB_AUDIO` switch
    now removes that synthesis body entirely for the playable baseline. The
    recovery function is 452 bytes, packaged data returns from about 18 MB to
    13.57 MB, and a controlled browser test renders Yoshi's complete 3D model
    in the VS character-select screen again.

## Remaining blockers

1. Reintroduce sound outside the oversized Asyncify audio coroutine. The
   current graphics-recovery baseline is intentionally silent; simply using
   the old runtime `audio=0` branch did not restore rendering because Asyncify
   still transformed the complete synthesis function.
2. The Raphnet adapter works through the standard Gamepad path. Raphnet Direct
   still needs its first browser permission/report exchange against physical
   hardware.
3. The desktop ImGui menu/overlay is skipped on web and needs a browser-safe
   implementation or configuration.
4. Playable scene and display-list validation still needs broader coverage
   after browser controls are connected.
5. The maximum-optimization (`-O3`/`NDEBUG`) build compiles to a 7.7 MB wasm but
   blocks the browser main thread during startup. Stripping the validated debug
   wasm also breaks startup, so the debug binary remains the deliverable until
   Asyncify/coroutine-safe optimization is isolated.
6. Fullscreen enter/exit and minimize/restore fixes are implemented and normal
   resize behavior is verified, but the browser automation environment cannot
   grant fullscreen permission. A final physical-browser Escape/restore test is
   still required.
7. The generated page still uses Emscripten's development shell. Its console is
   hidden by default; a fully branded shell is a later packaging task.

## Notes

Torch remains a host-side build step and successfully creates `BattleShip.o2r`
from the local ROM during the cross-build. The web target keeps all changes
local and reversible on branch `web-port`.
