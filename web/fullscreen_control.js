(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const SAVE_STORAGE_KEY = "battleship.ssb64.us.sram.v1";
  const N64_AUDIO_SAMPLE_RATE = 32000;
  // Keep audio close to the current video frame.  A larger queue makes menu
  // sounds play late after the browser resumes an AudioContext.
  const MAX_AUDIO_LEAD_SECONDS = 0.080;

  function clearWebAudioQueue(audio) {
    if (!audio) return;
    for (const source of audio.sources) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch (_) {
        // A source may already have ended; there is nothing left to cancel.
      }
    }
    audio.sources.clear();
    audio.nextTime = audio.context.currentTime + 0.010;
  }

  function updateAudioButton(text, disabled) {
    const button = document.getElementById("battleship-audio-button");
    if (!button) return;
    button.textContent = text;
    button.disabled = !!disabled;
  }

  globalThis.BattleShipPushWebAudio = function (pointer, frames) {
    if (!globalThis.BattleShipWebAudio) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      // Use the browser/device sample rate for the output context.  Individual
      // N64 buffers retain their native 32 kHz rate and WebAudio resamples them.
      const context = new AudioContextClass();
      const audio = { context, nextTime: context.currentTime, sources: new Set() };
      globalThis.BattleShipWebAudio = audio;
      const reflectState = () => {
        if (context.state === "running") {
          updateAudioButton("Sonido activado", true);
        }
      };
      context.addEventListener("statechange", reflectState);
      if (globalThis.BattleShipAudioUnlockRequested) {
        clearWebAudioQueue(audio);
        void context.resume().then(reflectState);
      }
      const resume = () => {
        if (context.state === "suspended") {
          // Never revive sounds collected while autoplay was blocked.
          clearWebAudioQueue(audio);
          void context.resume().then(reflectState);
        }
      };
      document.addEventListener("pointerdown", resume, { passive: true });
      document.addEventListener("keydown", resume, { passive: true });
    }

    const audio = globalThis.BattleShipWebAudio;
    const context = audio.context;
    // Browsers begin with WebAudio suspended.  Scheduling while suspended
    // creates an old queue that later plays over the battle audio.
    if (context.state !== "running") return;

    const now = context.currentTime;
    if (audio.nextTime < now - 0.010 || audio.nextTime > now + MAX_AUDIO_LEAD_SECONDS) {
      clearWebAudioQueue(audio);
    }

    const source = context.createBufferSource();
    const buffer = context.createBuffer(2, frames, N64_AUDIO_SAMPLE_RATE);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const input = pointer >> 1;
    for (let i = 0; i < frames; ++i) {
      left[i] = HEAP16[input + i * 2] / 32768;
      right[i] = HEAP16[input + i * 2 + 1] / 32768;
    }
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      audio.sources.delete(source);
      source.disconnect();
    };
    audio.sources.add(source);
    const startTime = Math.max(audio.nextTime, now + 0.010);
    source.start(startTime);
    audio.nextTime = startTime + frames / N64_AUDIO_SAMPLE_RATE;
  };

  let lastAudioSequence = 0;
  globalThis.BattleShipInstallWebAudioBridge = function (pointer, byteLengthPointer, sequencePointer) {
    globalThis.BattleShipWebAudioShared = { pointer, byteLengthPointer, sequencePointer };
  };

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 8192;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToBytes(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; ++i) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function persistWebSave(force) {
    const shared = globalThis.BattleShipWebSaveShared;
    if (!shared || typeof HEAPU8 === "undefined" || typeof HEAPU32 === "undefined") return;
    const sequence = HEAPU32[shared.sequencePointer >> 2];
    if (!force && sequence === shared.lastSequence) return;
    try {
      const snapshot = HEAPU8.slice(shared.pointer, shared.pointer + shared.size);
      localStorage.setItem(SAVE_STORAGE_KEY, bytesToBase64(snapshot));
      shared.lastSequence = sequence;
      globalThis.BattleShipWebSaveStatus = "saved";
    } catch (error) {
      globalThis.BattleShipWebSaveStatus = "unavailable";
      if (!shared.reportedError) {
        shared.reportedError = true;
        console.warn("BattleShip: browser save storage is unavailable", error);
      }
    }
  }

  globalThis.BattleShipInstallWebSaveBridge = function (pointer, size, sequencePointer) {
    const shared = { pointer, size, sequencePointer, lastSequence: 0, reportedError: false };
    globalThis.BattleShipWebSaveShared = shared;
    try {
      const encoded = localStorage.getItem(SAVE_STORAGE_KEY);
      if (encoded) {
        const restored = base64ToBytes(encoded);
        HEAPU8.set(restored.subarray(0, size), pointer);
        globalThis.BattleShipWebSaveStatus = "restored";
      } else {
        globalThis.BattleShipWebSaveStatus = "new";
      }
      shared.lastSequence = HEAPU32[sequencePointer >> 2];
    } catch (error) {
      globalThis.BattleShipWebSaveStatus = "unavailable";
      shared.reportedError = true;
      console.warn("BattleShip: could not restore browser save", error);
    }
  };

  window.setInterval(() => persistWebSave(false), 250);
  window.addEventListener("pagehide", () => persistWebSave(true));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) persistWebSave(true);
  });

  globalThis.BattleShipInstallWebInputBridge = function (pointer, countPointer, capacity) {
    globalThis.BattleShipWebInputShared = { pointer, countPointer, capacity };
  };

  const activeRaphnetGamepads = new Set();
  const webKeyboardKeys = new Set();
  const webKeyboardReleases = new Map();
  const webKeyboardCodes = new Set([
    "KeyW", "KeyA", "KeyS", "KeyD", "KeyX", "KeyC", "KeyZ",
    "KeyE", "KeyR", "KeyT", "KeyF", "KeyG", "KeyH", "Space",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"
  ]);
  document.addEventListener("keydown", (event) => {
    if (webKeyboardCodes.has(event.code)) {
      webKeyboardKeys.add(event.code);
      event.preventDefault();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (webKeyboardCodes.has(event.code)) {
      webKeyboardKeys.delete(event.code);
      event.preventDefault();
    }
  });
  window.addEventListener("blur", () => {
    webKeyboardKeys.clear();
  });
  const RAPHNET_VENDOR_IDS = [0x289b, 0x1781, 0x1740];
  const REPORT_SIZE_CANDIDATES = [63, 32];
  const REQUEST_SUSPEND_POLLING = 0x03;
  const REQUEST_GET_VERSION = 0x04;
  const REQUEST_GET_CONTROLLER_TYPE = 0x06;
  const REQUEST_RAW_SI = 0x80;
  const N64_GET_STATUS = 0x01;

  const raphnetBridge = {
    device: null,
    reportSize: 0,
    ports: [],
    running: false,
    errorCount: 0,
  };

  const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextRaf = () => new Promise((resolve) => requestAnimationFrame(resolve));

  function responseBytes(dataView, expectedOpcode) {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    if (bytes.length > 1 && bytes[0] === 0 && bytes[1] === expectedOpcode) {
      return bytes.slice(1);
    }
    return bytes;
  }

  async function exchangeRaphnet(command, timeoutMilliseconds) {
    if (!raphnetBridge.device || !raphnetBridge.device.opened || raphnetBridge.reportSize <= 0) {
      throw new Error("Raphnet no está abierto");
    }
    const output = new Uint8Array(raphnetBridge.reportSize);
    output.set(command.slice(0, raphnetBridge.reportSize));
    await raphnetBridge.device.sendFeatureReport(0, output);
    const deadline = performance.now() + timeoutMilliseconds;
    do {
      const dataView = await raphnetBridge.device.receiveFeatureReport(0);
      const bytes = responseBytes(dataView, command[0]);
      if (bytes.length > 0 && bytes[0] === command[0]) {
        return bytes;
      }
      await waitMs(1);
    } while (performance.now() < deadline);
    throw new Error(`Raphnet no respondió al comando 0x${command[0].toString(16)}`);
  }

  async function chooseReportSize() {
    for (const candidate of REPORT_SIZE_CANDIDATES) {
      raphnetBridge.reportSize = candidate;
      try {
        const reply = await exchangeRaphnet(new Uint8Array([REQUEST_SUSPEND_POLLING, 0]), 250);
        if (reply[0] === REQUEST_SUSPEND_POLLING) return candidate;
      } catch (_) {}
    }
    raphnetBridge.reportSize = 0;
    throw new Error("La interfaz seleccionada no acepta comandos Raphnet");
  }

  async function findN64Channels() {
    const channels = [];
    for (let channel = 0; channel < 4; channel++) {
      try {
        const reply = await exchangeRaphnet(new Uint8Array([REQUEST_GET_CONTROLLER_TYPE, channel]), 150);
        if (reply.length >= 3 && reply[1] === channel && reply[2] === 1) channels.push(channel);
      } catch (_) {}
    }
    if (channels.length === 0) {
      for (let channel = 0; channel < 4; channel++) {
        try {
          const reply = await exchangeRaphnet(new Uint8Array([REQUEST_RAW_SI, channel, 1, N64_GET_STATUS]), 150);
          if (reply.length >= 7 && reply[1] === channel && reply[2] === 4) channels.push(channel);
        } catch (_) {}
      }
    }
    return channels;
  }

  async function pollRaphnetLoop() {
    while (raphnetBridge.running && raphnetBridge.device && raphnetBridge.device.opened) {
      for (const port of raphnetBridge.ports) {
        try {
          const reply = await exchangeRaphnet(new Uint8Array([REQUEST_RAW_SI, port.channel, 1, N64_GET_STATUS]), 50);
          if (reply.length >= 7 && reply[1] === port.channel && reply[2] === 4) {
            port.button = ((reply[3] << 8) | reply[4]) >>> 0;
            port.stickX = (reply[5] << 24) >> 24;
            port.stickY = (reply[6] << 24) >> 24;
            port.connected = true;
            port.timestamp = performance.now();
            raphnetBridge.errorCount = 0;
          }
        } catch (e) {
          raphnetBridge.errorCount++;
        }
      }
      await nextRaf();
    }
  }

  raphnetBridge.disconnect = async function () {
    raphnetBridge.running = false;
    const device = raphnetBridge.device;
    raphnetBridge.device = null;
    raphnetBridge.ports = [];
    if (device && device.opened) {
      try {
        raphnetBridge.device = device;
        await exchangeRaphnet(new Uint8Array([REQUEST_SUSPEND_POLLING, 0]), 150);
      } catch (_) {}
      finally {
        raphnetBridge.device = null;
      }
      try { await device.close(); } catch (_) {}
    }
    raphnetBridge.reportSize = 0;
  };

  raphnetBridge.connect = async function () {
    if (raphnetBridge.running) {
      await raphnetBridge.disconnect();
      return;
    }
    if (!("hid" in navigator)) {
      alert("WebHID no está disponible en este navegador. Usa Google Chrome o Microsoft Edge.");
      return;
    }
    try {
      const devices = await navigator.hid.requestDevice({
        filters: RAPHNET_VENDOR_IDS.map((vendorId) => ({ vendorId })),
      });
      if (!devices.length) return;
      const device = devices[0];
      await device.open();
      raphnetBridge.device = device;
      await chooseReportSize();
      await exchangeRaphnet(new Uint8Array([REQUEST_SUSPEND_POLLING, 1]), 250);
      const channels = await findN64Channels();
      if (!channels.length) throw new Error("No se encontró mando N64 conectado al adaptador");
      raphnetBridge.ports = channels.slice(0, 4).map((channel) => ({
        channel, button: 0, stickX: 0, stickY: 0, connected: false, timestamp: 0,
      }));
      raphnetBridge.running = true;
      console.info("BattleShip Raphnet WebHID conectado", { productName: device.productName, channels });
      void pollRaphnetLoop();
    } catch (err) {
      console.error("BattleShip Raphnet error:", err);
      alert("Error al conectar Raphnet: " + err.message);
      await raphnetBridge.disconnect();
    }
  };

  globalThis.BattleShipRaphnet = raphnetBridge;

  window.addEventListener("gamepadconnected", (event) => {
    console.info("Mando Gamepad API conectado:", event.gamepad.id);
  });
  window.addEventListener("gamepaddisconnected", (event) => {
    console.info("Mando Gamepad API desconectado:", event.gamepad.id);
  });

  function pumpWebInput() {
    const shared = globalThis.BattleShipWebInputShared;
    if (shared && typeof HEAPU32 !== "undefined") {
      const visibleIds = [];
      let count = 0;
      let liveDebugText = "Sin entrada activa";

      const writePad = (button, stickX, stickY, isRaphnet) => {
        if (count >= shared.capacity) return;
        const base = shared.pointer + count * 6;
        HEAPU8[base + 0] = button & 0xff;
        HEAPU8[base + 1] = (button >> 8) & 0xff;
        HEAP8[base + 2] = stickX;
        HEAP8[base + 3] = stickY;
        HEAPU8[base + 4] = 1;
        HEAPU8[base + 5] = isRaphnet ? 1 : 0;
        count++;
      };

      const direct = globalThis.BattleShipRaphnet;
      if (direct && direct.running && Array.isArray(direct.ports)) {
        const now = performance.now();
        for (let port = 0; port < direct.ports.length && count < shared.capacity; ++port) {
          const state = direct.ports[port];
          if (!state || !state.connected || now - state.timestamp >= 500) continue;
          writePad(state.button >>> 0, state.stickX | 0, state.stickY | 0, true);
          visibleIds.push(`Raphnet Direct ${port + 1}`);
          liveDebugText = `Raphnet P${port+1}: Stick (${state.stickX}, ${state.stickY}) | Mask: 0x${(state.button >>> 0).toString(16)}`;
        }
      }

      if (count === 0) {
        let gamepads = [];
        try {
          gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        } catch (_) {
          gamepads = [];
        }
        const present = new Set();
        const isPressed = (btn) => {
          if (!btn) return false;
          if (typeof btn === "object") {
            return !!btn.pressed || (Number.isFinite(btn.value) && btn.value > 0.5);
          }
          return !!btn;
        };
        const down = (pad, index) => isPressed(pad.buttons && pad.buttons[index]);
        const axis = (pad, index) => (pad.axes && Number.isFinite(pad.axes[index]))
          ? Math.max(-1, Math.min(1, pad.axes[index])) : 0;
        const stick = (value, deadzone) => Math.abs(value) < deadzone ? 0 : Math.max(-80, Math.min(80, Math.round(value * 80)));
        const set = (mask, condition, bit) => condition ? (mask | bit) : mask;

        for (const pad of gamepads) {
          if (!pad || !pad.connected || count >= shared.capacity) continue;
          present.add(pad.index);
          const id = String(pad.id || "");
          const lowerId = id.toLowerCase();
          const isStandard = pad.mapping === "standard";
          const isN64 = lowerId.includes("raphnet") || lowerId.includes("289b") ||
                        lowerId.includes("1781") || lowerId.includes("1740") ||
                        lowerId.includes("n64") || lowerId.includes("retro") ||
                        lowerId.includes("mayflash") || lowerId.includes("innext");

          let mask = 0;

          if (isN64) {
            mask = set(mask, down(pad, 0), 0x8000); // A
            mask = set(mask, down(pad, 1), 0x4000); // B
            mask = set(mask, down(pad, 2), 0x2000); // Z
            mask = set(mask, down(pad, 3) || down(pad, 9), 0x1000); // Start
            mask = set(mask, down(pad, 4), 0x0020); // L
            mask = set(mask, down(pad, 5), 0x0010); // R
            mask = set(mask, down(pad, 6), 0x0008); // C-Up
            mask = set(mask, down(pad, 7), 0x0004); // C-Down
            mask = set(mask, down(pad, 8), 0x0002); // C-Left
            mask = set(mask, down(pad, 9) && !down(pad, 3), 0x0001); // C-Right
            if (pad.buttons.length >= 14) {
              mask = set(mask, down(pad, 10), 0x0800); // D-Up
              mask = set(mask, down(pad, 11), 0x0400); // D-Down
              mask = set(mask, down(pad, 12), 0x0200); // D-Left
              mask = set(mask, down(pad, 13), 0x0100); // D-Right
            }
          } else if (isStandard) {
            mask = set(mask, down(pad, 0), 0x8000); // A (Bottom face)
            mask = set(mask, down(pad, 1), 0x4000); // B (Right face)
            mask = set(mask, down(pad, 2) || down(pad, 3), 0x0008); // X/Y -> Jump
            mask = set(mask, down(pad, 4), 0x0020); // L / L1
            mask = set(mask, down(pad, 5), 0x0010); // R / R1
            mask = set(mask, down(pad, 6) || down(pad, 7), 0x2000); // Z (L2 / R2)
            mask = set(mask, down(pad, 9), 0x1000); // Start
            mask = set(mask, down(pad, 12), 0x0800); // D-Up
            mask = set(mask, down(pad, 13), 0x0400); // D-Down
            mask = set(mask, down(pad, 14), 0x0200); // D-Left
            mask = set(mask, down(pad, 15), 0x0100); // D-Right

            if (pad.axes.length >= 4) {
              const rx = axis(pad, 2);
              const ry = axis(pad, 3);
              if (Math.abs(ry) > 0.6) {
                mask = set(mask, ry < -0.6, 0x0008);
                mask = set(mask, ry > 0.6, 0x0004);
              }
              if (Math.abs(rx) > 0.6) {
                mask = set(mask, rx < -0.6, 0x0002);
                mask = set(mask, rx > 0.6, 0x0001);
              }
            }
          } else {
            mask = set(mask, down(pad, 0), 0x8000);
            mask = set(mask, down(pad, 1), 0x4000);
            mask = set(mask, down(pad, 2), 0x2000);
            mask = set(mask, down(pad, 3), 0x0008);
            mask = set(mask, down(pad, 4), 0x0020);
            mask = set(mask, down(pad, 5), 0x0010);
            mask = set(mask, down(pad, 6) || down(pad, 7), 0x2000);
            mask = set(mask, down(pad, 8) || down(pad, 9), 0x1000);
            if (pad.buttons.length >= 16) {
              mask = set(mask, down(pad, 12), 0x0800);
              mask = set(mask, down(pad, 13), 0x0400);
              mask = set(mask, down(pad, 14), 0x0200);
              mask = set(mask, down(pad, 15), 0x0100);
            }
          }

          const deadzone = isN64 ? 0.06 : 0.20;
          const sx = stick(axis(pad, 0), deadzone);
          const sy = stick(-axis(pad, 1), deadzone);

          writePad(mask, sx, sy, isN64);
          visibleIds.push(id || "Mando");
          liveDebugText = `[${id.substring(0, 18)}] Stick: (${sx}, ${sy}) | Mask: 0x${mask.toString(16).toUpperCase()}`;
        }
        for (const index of Array.from(activeRaphnetGamepads)) {
          if (!present.has(index)) activeRaphnetGamepads.delete(index);
        }
      }

      if (count === 0 && webKeyboardKeys.size > 0) {
        let mask = 0;
        const held = (code) => webKeyboardKeys.has(code);
        if (held("KeyX")) mask |= 0x8000;
        if (held("KeyC")) mask |= 0x4000;
        if (held("KeyZ")) mask |= 0x2000;
        if (held("Space")) mask |= 0x1000;
        if (held("KeyE")) mask |= 0x0020;
        if (held("KeyR")) mask |= 0x0010;
        if (held("ArrowUp")) mask |= 0x0800;
        if (held("ArrowDown")) mask |= 0x0400;
        if (held("ArrowLeft")) mask |= 0x0200;
        if (held("ArrowRight")) mask |= 0x0100;
        const stickX = (held("KeyD") ? 80 : 0) - (held("KeyA") ? 80 : 0);
        const stickY = (held("KeyW") ? 80 : 0) - (held("KeyS") ? 80 : 0);
        writePad(mask, stickX, stickY, false);
        visibleIds.push("Teclado");
        liveDebugText = `Teclado: Stick (${stickX}, ${stickY}) | Teclas: ${Array.from(webKeyboardKeys).join(",")}`;
      }

      const liveDebugElem = document.getElementById("battleship-live-input-indicator");
      if (liveDebugElem) {
        liveDebugElem.textContent = liveDebugText;
      }

      HEAPU32[shared.countPointer >> 2] = count;
      globalThis.BattleShipWebInputState = {
        connected: count,
        ids: visibleIds,
        debug: liveDebugText,
        timestamp: performance.now()
      };
    }
    requestAnimationFrame(pumpWebInput);
  }
  requestAnimationFrame(pumpWebInput);

  function pumpWebAudio() {
    try {
      const shared = globalThis.BattleShipWebAudioShared;
      if (shared && typeof HEAPU32 !== "undefined") {
        const sequence = HEAPU32[shared.sequencePointer >> 2];
        if (sequence !== lastAudioSequence) {
          lastAudioSequence = sequence;
          const pointer = shared.pointer;
          const byteLength = HEAPU32[shared.byteLengthPointer >> 2];
          if (pointer && byteLength >= 4) {
            globalThis.BattleShipPushWebAudio(pointer, Math.floor(byteLength / 4));
          }
        }
      }
    } catch (error) {
      if (!globalThis.BattleShipWebAudioPollError) {
        globalThis.BattleShipWebAudioPollError = true;
        console.error("BattleShip WebAudio poll failed", error);
      }
    }
    requestAnimationFrame(pumpWebAudio);
  }
  requestAnimationFrame(pumpWebAudio);

  function fitCanvas() {
    const fit = globalThis.BattleShipFitCanvas;
    if (typeof fit === "function") {
      fit();
    }
    const schedule = globalThis.BattleShipScheduleCanvasFit;
    if (typeof schedule === "function") schedule();
    else if (typeof fit === "function") {
      requestAnimationFrame(() => requestAnimationFrame(fit));
      setTimeout(fit, 180);
    }
  }

  function syncFullscreenUi() {
    const button = document.querySelector('[data-battleship-fullscreen="true"]');
    if (button) {
      button.value = document.fullscreenElement ? "Salir de pantalla completa" : "Pantalla completa";
    }
    fitCanvas();
  }

  async function toggleFullscreen() {
    const canvas = document.getElementById("canvas");
    if (!canvas) return;
    const host = canvas.parentElement || canvas;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await host.requestFullscreen({ navigationUI: "hide" });
      }
    } catch (error) {
      console.error("BattleShip fullscreen failed", error);
    } finally {
      syncFullscreenUi();
      setTimeout(syncFullscreenUi, 250);
    }
  }

  function install() {
    const button = Array.from(document.querySelectorAll('input[type="button"]'))
      .find((element) => element.value === "Fullscreen" || element.value === "Pantalla completa");
    if (!button || button.dataset.battleshipFullscreen === "true") return;

    button.dataset.battleshipFullscreen = "true";
    button.value = "Pantalla completa";
    button.onclick = (event) => {
      event.preventDefault();
      void toggleFullscreen();
      return false;
    };

    const audioButton = document.createElement("button");
    audioButton.id = "battleship-audio-button";
    audioButton.textContent = "Activar sonido";
    audioButton.style.cssText = "margin-left:8px;padding:4px 10px;cursor:pointer";
    audioButton.onclick = () => {
      globalThis.BattleShipAudioUnlockRequested = true;
      const audio = globalThis.BattleShipWebAudio;
      const context = audio && audio.context;
      if (context) {
        // The button is an explicit request for live audio, not playback of
        // any sounds generated before the user allowed WebAudio.
        clearWebAudioQueue(audio);
        void context.resume().then(() => {
          updateAudioButton("Sonido activado", true);
        });
      } else {
        updateAudioButton("Sonido preparado", false);
      }
    };
    button.insertAdjacentElement("afterend", audioButton);

    const raphnetButton = document.createElement("button");
    raphnetButton.id = "battleship-raphnet-button";
    raphnetButton.textContent = "🔌 Conectar Raphnet / WebHID";
    raphnetButton.style.cssText = "margin-left:8px;padding:4px 10px;cursor:pointer;font-weight:600";
    raphnetButton.onclick = async () => {
      const raph = globalThis.BattleShipRaphnet;
      if (raph && typeof raph.connect === "function") {
        await raph.connect();
        raphnetButton.textContent = raph.running ? "Desconectar Raphnet" : "🔌 Conectar Raphnet / WebHID";
      } else {
        alert("WebHID solo está disponible en navegadores basados en Chromium (Chrome, Edge, Opera, Brave).");
      }
    };
    audioButton.insertAdjacentElement("afterend", raphnetButton);

    const output = document.getElementById("output");
    if (output) {
      const diagnosticsButton = document.createElement("button");
      diagnosticsButton.id = "battleship-diagnostics-button";
      diagnosticsButton.textContent = "Diagnóstico";
      diagnosticsButton.style.cssText = "margin-left:8px;padding:4px 10px;cursor:pointer";
      const diagnosticsRequested = new URLSearchParams(window.location.search).get("debug") === "1";
      output.style.display = diagnosticsRequested ? "block" : "none";
      diagnosticsButton.onclick = () => {
        const visible = output.style.display !== "none";
        output.style.display = visible ? "none" : "block";
        diagnosticsButton.textContent = visible ? "Diagnóstico" : "Ocultar diagnóstico";
        fitCanvas();
      };
      raphnetButton.insertAdjacentElement("afterend", diagnosticsButton);
    }

    document.addEventListener("fullscreenchange", () => {
      // Output devices can be reconfigured when entering/exiting fullscreen.
      // Drop the tiny scheduled tail so it cannot become slow or distorted.
      clearWebAudioQueue(globalThis.BattleShipWebAudio);
      syncFullscreenUi();
    });

    // Some Chromium shells leave fullscreen without delivering the page-level
    // event. Reconcile the UI and container styles when that happens.
    let lastFullscreen = !!document.fullscreenElement;
    window.setInterval(() => {
      const fullscreen = !!document.fullscreenElement;
      if (fullscreen !== lastFullscreen ||
          button.value !== (fullscreen ? "Salir de pantalla completa" : "Pantalla completa")) {
        lastFullscreen = fullscreen;
        syncFullscreenUi();
      }
    }, 250);

    const overlayHost = document.getElementById("canvas")?.parentElement || document.body;
    const status = document.createElement("div");
    status.id = "battleship-gamepad-status";
    status.textContent = "Mando: pulsa un botón para activarlo";
    status.style.cssText = [
      "position:fixed", "right:12px", "bottom:12px", "z-index:10000",
      "padding:7px 11px", "border-radius:8px", "background:rgba(18,18,22,.9)",
      "color:#eee", "font:13px/1.3 system-ui,sans-serif", "pointer-events:none"
    ].join(";");
    // Keep the notice inside the element that enters fullscreen so controller
    // connection feedback remains visible there as well.
    overlayHost.appendChild(status);

    const saveStatus = document.createElement("div");
    saveStatus.id = "battleship-save-status";
    saveStatus.textContent = "Preparando guardado local…";
    saveStatus.style.cssText = [
      "position:fixed", "left:12px", "bottom:12px", "z-index:10000",
      "padding:7px 11px", "border-radius:8px", "background:rgba(18,18,22,.9)",
      "color:#eee", "font:13px/1.3 system-ui,sans-serif", "pointer-events:none"
    ].join(";");
    overlayHost.appendChild(saveStatus);

    let lastSaveState = "";
    window.setInterval(() => {
      const saveState = globalThis.BattleShipWebSaveStatus || "waiting";
      if (saveState === lastSaveState) return;
      lastSaveState = saveState;
      const labels = {
        waiting: "Preparando guardado local…",
        new: "Guardado local listo",
        restored: "Partida restaurada",
        saved: "Partida guardada",
        unavailable: "Guardado local no disponible"
      };
      saveStatus.textContent = labels[saveState] || "Guardado local listo";
      saveStatus.style.color = saveState === "unavailable" ? "#ffb4ab" : "#8ff0a4";
    }, 250);

    window.setInterval(() => {
      const state = globalThis.BattleShipWebInputState;
      const connected = state && Number.isFinite(state.connected) ? state.connected : 0;
      if (connected > 0) {
        status.textContent = state.debug || (connected === 1 ? `Mando: ${state.ids[0] || "J1"}` : `${connected} mandos`);
        status.style.color = "#8ff0a4";
      } else {
        status.textContent = "Mando no detectado — pulsa un botón (o usa teclado: WASD / X,C,Z, Espacio)";
        status.style.color = "#eee";
      }
    }, 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
