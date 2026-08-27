# Directivas del Port SSB64 Web / PC & Mapeo de Subsistemas

## Mapeo y Trazabilidad de Subsistemas
Cada problema o cambio debe rastrearse a través de todas las capas correspondientes usando la habilidad `.agents/skills/smashweb-architect/`:
1. **Audio (Sonido/Volumen/Mute)**:
   - UI (`web/index.html`, `webap/SmashWeb.html`) -> Bridge JS (`web/fullscreen_control.js`) -> C++ (`port/audio/`) -> Decompilación (`decomp/src/sys/audio.c`).
2. **Gráficos y Visuales (HUD/Encuadre 4:3/Modelos 3D)**:
   - UI/Canvas CSS (`web/index.html`) -> Backend SDL2 (`libultraship/src/fast/backends/gfx_sdl2.cpp`) -> Fast3D Walker (`port/port_dl_ranges.cpp`) -> Relocs (`port/bridge/lbreloc_bridge.cpp`) -> Decompilación (`decomp/src/sc/`, `decomp/src/ft/`).
3. **Controles (Mando/Raphnet/Teclado/Touch)**:
   - Frontend (`web/fullscreen_control.js`, `web/raphnet_webhid.js`) -> C++ Glue (`port/sys/controller.cpp`) -> Decompilación (`decomp/src/sys/sycontroller.c`).
4. **Guardado (SRAM/LocalStorage)**:
   - LocalStorage (`web/fullscreen_control.js`) -> C++ Save (`port/save/`) -> Decompilación (`decomp/src/sys/backup.c`).

## Reglas de Código y Compilación
1. **Preservación de Decompilación**:
   - Mantener modismos IDO necesarios para el juego, pero corregir o encapsular incompatibilidades modernas de tipos/punteros (`#if UINTPTR_MAX > ...`).
   - Evitar `if (dummy);` o advertencias de compilador; utilizar `(void)dummy;` para referencias limpias.
2. **Seguridad en tipos LP64 vs 32-bit (WASM)**:
   - En WASM 32-bit `uintptr_t` es de 32 bits. Evitar comparaciones tautológicas con constantes de 64 bits sin condicionales de compilación.
3. **Verificación antes de finalizar**:
   - Comprobar que los cambios sintácticos y de tipos no introduzcan advertencias ni rompan submódulos (`decomp/`, `libultraship/`, `torch/`).
