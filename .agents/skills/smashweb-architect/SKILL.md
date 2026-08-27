---
name: smashweb-architect
description: >-
  Mapa arquitectónico integral y guía de subsistemas para Super Smash Bros. 64 Web / PC Port.
  Permite rastrear cualquier componente visual, sonoro, de entrada o de memoria a través de
  todas las capas del código (Web UI -> JS Bridge -> C++ Port Glue -> Decompilacion N64 -> Libultraship -> Assets).
---

# SmashWeb Architectural Mapping & Subsystem Guide

Este mapa conecta cada elemento visual, sonoro y funcional del juego con todos los archivos de código responsables en la arquitectura multiplataforma.

---

## 1. Subsistema de Audio (Música, Efectos de Sonido, Voces y Locutor)

Cuando ocurra un problema de sonido, volumen o sincronización, intervenir en estas capas:

| Capa | Archivos Clave | Responsabilidad |
| :--- | :--- | :--- |
| **Frontend Web / UI** | `web/index.html`<br>`webap/SmashWeb.html` | Sliders de volumen, botón mute, interceptor global de `AudioContext` y `GainNode`. |
| **Puente JavaScript** | `web/fullscreen_control.js` | `BattleShipPushWebAudio`, `pumpWebAudio`, `BattleShipSetVolume`, gestión de buffers PCM a 32 kHz. |
| **C++ Port Bridge** | `port/audio/audio_playback.cpp`<br>`port/audio/audio_playback.h` | `portAudioPushSilence`, `portAudioPumpWeb`, `queueWebAudio`, comunicación con Emscripten. |
| **Decompilación Core** | `decomp/src/sys/audio.c`<br>`decomp/src/sys/audio.h` | Sintetizador de audio N64 original, secuencias MIDI (`SEQ`), SoundFont (`FONT`) y muestras ADPCM. |
| **Extracción Assets** | `torch/src/factories/naudio/` | Extracción de tablas de audio desde la ROM (`AudioContext.cpp`, `AudioTableFactory.cpp`). |

---

## 2. Subsistema Visual y Gráfico (Modelos 3D, Texturas, HUD, 4:3 y Canvas)

Para problemas de encuadre, recorte lateral, resolución, pérdida de texturas o renderizado de personajes/escenarios:

| Capa | Archivos Clave | Responsabilidad |
| :--- | :--- | :--- |
| **Frontend Web / UI** | `web/index.html`<br>`webap/SmashWeb.html` | Contenedor `.game-viewport`, canvas responsivo con relación 4:3, modo Pantalla Completa sin deformación. |
| **WebGL 2 / SDL2 Backend** | `libultraship/src/fast/backends/gfx_sdl2.cpp` | `BattleShipFitCanvas`, inicialización del contexto WebGL 2, asignación del backing buffer a 1280x960. |
| **GBI / Fast3D Walker** | `libultraship/src/fast/interpreter.cpp`<br>`port/port_dl_ranges.cpp` | Intérprete de Display Lists (DL) de N64, verificación de límites de memoria y clasificación de punteros. |
| **Token Pointers / Relocs** | `port/bridge/lbreloc_bridge.cpp`<br>`port/resource/RelocFileTable.*.cpp` | Resolución de punteros de texturas, animaciones y tablas de vértices (`RELOC_RESOLVE`). |
| **Decompilación Escenas** | `decomp/src/sc/`<br>`decomp/src/ft/` (Luchadores)<br>`decomp/src/gr/` (Escenarios) | Lógica de renderizado de personajes, escenarios, menús (`scstaffroll.c`, `sctitle.c`, etc.). |

---

## 3. Subsistema de Controles y Entrada (Gamepads, Raphnet N64, Teclado, Touch)

Para problemas de respuesta de botones, sticks, deadzones o mapeo:

| Capa | Archivos Clave | Responsabilidad |
| :--- | :--- | :--- |
| **Teclado & Gamepad API** | `web/fullscreen_control.js` | `pumpWebInput`, mapeo WASD / X, C, Z, Espacio, flechas C-buttons, deadzones analógicos. |
| **Adaptador Raphnet WebHID** | `web/raphnet_webhid.js` | Conexión directa USB / WebHID para mandos originales de Nintendo 64 (4 canales simultáneos). |
| **C++ Controller Glue** | `port/sys/controller.cpp` | Lectura de los estados de mandos desde la memoria compartida de WebAssembly. |
| **Decompilación Input** | `decomp/src/sys/sycontroller.c` | Lógica de lectura de puertos de N64, máscaras de botones y procesado de combos. |

---

## 4. Subsistema de Guardado y Persistencia (SRAM)

Para partidas guardadas, desbloqueo de personajes ocultos y records:

| Capa | Archivos Clave | Responsabilidad |
| :--- | :--- | :--- |
| **Web LocalStorage** | `web/fullscreen_control.js` | `persistWebSave`, `restoreWebSave` (buffer SRAM de 32 KiB codificado en Base64 en localStorage). |
| **C++ Save Bridge** | `port/save/` | Mapeo de la memoria Flash/SRAM del juego a la estructura de archivos/web. |
| **Decompilación Save** | `decomp/src/sys/backup.c` | Lógica original de lectura y escritura de partidas de SSB64. |

---

## 5. Subsistema de Compilación y Servidor Local

| Componente | Archivo |
| :--- | :--- |
| **Servidor Web Local (COOP/COEP)** | `scripts/serve_web.py` (Puerto por defecto: 8080) |
| **Configuración CMake** | `CMakeLists.txt`, `CMakePresets.json` (`web-debug`, `web-release`) |
| **Toolchain Emscripten** | `tools/emsdk/` (`emsdk_env.ps1`) |
