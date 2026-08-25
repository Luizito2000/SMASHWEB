# Web audio recovery without enlarging the Asyncify fiber

Scope: BattleShip vanilla web build only. `BattleShipGraphicsRecovery` remains
the playable, silent reference and must not be overwritten.

## Proven failure mode

The regression is structural, not a WebAudio queue or asset-size problem.
`llvm-nm --print-size` reports:

| Build | `syAudioThreadMain` size |
| --- | ---: |
| `BattleShipWeb7` pre-audio reference | 587 bytes (`0x24b`) |
| `BattleShipGraphicsRecovery` (`SSB64_WEB_AUDIO=OFF`) | 452 bytes (`0x1c4`) |
| `BattleShipAudioSync` (`SSB64_WEB_AUDIO=ON`) | 7,713 bytes (`0x1e21`) |

The enabled implementation keeps synthesis, sequence state handling, asset
reload logic, and their locals in `syAudioThreadMain`, on both sides of a
blocking `osRecvMesg`. Asyncify must therefore preserve a much larger emulated
fiber frame. A runtime `audio=0` branch cannot undo that transformation.

The eight extracted audio blobs and the browser PCM bridge are already
synchronous. Their payload is about 4.4 MiB and is separate from the Asyncify
stack. The WebAudio callback also runs from `requestAnimationFrame`, not from
the suspended N64 fiber. Those pieces can be retained.

## Safe architecture

Keep `syAudioThreadMain` permanently small in every web configuration:

1. It creates its message queues with `syAudioInit`.
2. A no-yield initialization helper loads the pre-extracted MEMFS blobs and
   creates the players, then returns before the thread can suspend.
3. It sends the normal ready message.
4. Its loop only consumes the audio tick and records one pending tick. It does
   no synthesis, archive access, JavaScript call, logging through a worker, or
   heap rebuild.
5. The existing `portAudioPumpWeb` hook, called after `PortPushFrame` and after
   all service fibers have yielded, drains the pending tick by invoking a
   synchronous `syAudioPumpWeb` helper. That helper runs `n_alAudioFrame`, the
   FGM cleanup, BGM state machine, volume fades, and the web-safe settings
   acknowledgements.
6. PCM publication remains a memory copy plus sequence counter. JavaScript
   reads it later from its own `requestAnimationFrame` callback.

The important invariant is that no function performing synthesis may contain,
or call, `osRecvMesg(..., OS_MESG_BLOCK)`, `port_coroutine_yield`,
`emscripten_fiber_swap`, `EM_ASM`, or a worker-backed resource request.

## Staged acceptance gates

Build into a new directory and basename (for example
`build-web-audio-pump/BattleShipAudioPump`) with `SSB64_WEB_AUDIO=ON`; never
reuse `BattleShipGraphicsRecovery`.

1. **Static gate:** `syAudioThreadMain` must remain close to the recovery size.
   Reject the build if it exceeds 1 KiB. Confirm that the new synchronous pump
   owns the large body and has no Asyncify suspension calls.
2. **Silent visual gate:** load with `?audio=0` and compare title, character
   select, and a two-player match to GraphicsRecovery. Fighters, stage, HUD,
   and animation must remain visible.
3. **Synthesis gate:** load normally and require logs for asset initialization,
   first `n_alAudioFrame`, and first non-zero PCM block.
4. **Autoplay gate:** before a gesture no PCM backlog may be scheduled. After
   pressing `Activar sonido`, only current audio should play.
5. **Timing gate:** run menu-to-match, fullscreen enter/exit, tab hide/restore,
   and at least ten minutes of play. Queue lead must stay at or below 80 ms,
   with no delayed menu sounds or raspy tail.
6. **Scene gate:** exercise title, mode select, character select, several
   stages, results, and repeated rematches. Settings/restart acknowledgements
   must not deadlock a game fiber.

## Remaining risks

- A single shared PCM block intentionally favors latency over completeness. If
  browser animation falls behind, intermediate blocks can be replaced and
  cause a click. A fixed 3-block lock-free ring can be added only after the
  graphics and synchronization gates pass.
- Initialization still runs synchronously during boot. It must return before
  the first fiber suspension; any future archive/worker access would violate
  the invariant.
- The native settings path rebuilds the audio heap. Web currently acknowledges
  settings/restart requests without rebuilding because pointers into that heap
  remain live. Broader scene testing is required before changing this policy.
- Debug builds are the validated baseline. Audio recovery must not be combined
  with the unresolved optimized-build startup investigation.

