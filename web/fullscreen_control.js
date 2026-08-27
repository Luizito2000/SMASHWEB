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
      const pending = webKeyboardReleases.get(event.code);
      if (pending) window.clearTimeout(pending);
      webKeyboardReleases.delete(event.code);
      webKeyboardKeys.add(event.code);
      event.preventDefault();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (webKeyboardCodes.has(event.code)) {
      // Keep very quick taps alive for several requestAnimationFrame samples.
      // Automated tests and fast keyboards can otherwise deliver keydown and
      // keyup between two 60 Hz input pumps, losing the button completely.
      const pending = window.setTimeout(() => {
        webKeyboardKeys.delete(event.code);
        webKeyboardReleases.delete(event.code);
      }, 400);
      webKeyboardReleases.set(event.code, pending);
      event.preventDefault();
    }
  });
  window.addEventListener("blur", () => {
    webKeyboardKeys.clear();
  });

  const RAPHNET_VENDOR_IDS = [0x289b, 0x1781, 0x1740];
  const REPORT_SIZE_CANDIDATES = [64, 63, 32, 16, 8];
  const REQUEST_SUSPEND_POLLING = 0x03;
  const REQUEST_GET_CONTROLLER_TYPE = 0x06;
  const REQUEST_RAW_SI = 0x80;
  const N64_GET_STATUS = 0x01;

  const raphnetBridge = {
    devices: [],
    ports: [],
    running: false,
    mode: "auto",
  };

  function handleRaphnetInputReport(event) {
    const data = event.data;
    if (!data || data.byteLength < 4) return;
    if (!raphnetBridge.ports.length) {
      raphnetBridge.ports = [{ channel: 0, button: 0, stickX: 0, stickY: 0, connected: true, timestamp: performance.now() }];
    }
    const port = raphnetBridge.ports[0];
    port.connected = true;
    port.timestamp = performance.now();
    const b0 = data.getUint8(0);
    const b1 = data.getUint8(1);
    const sx = data.getInt8(2);
    const sy = -data.getInt8(3);
    port.button = ((b0 << 8) | b1) >>> 0;
    port.stickX = sx;
    port.stickY = sy;
  }

  async function exchangeDevice(device, reportSize, command, timeoutMs) {
    const output = new Uint8Array(reportSize);
    output.set(command.slice(0, reportSize));
    await device.sendFeatureReport(0, output);
    const deadline = performance.now() + timeoutMs;
    do {
      try {
        const dataView = await device.receiveFeatureReport(0);
        const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
        const effective = (bytes.length > 1 && bytes[0] === 0 && bytes[1] === command[0]) ? bytes.slice(1) : bytes;
        if (effective.length > 0 && effective[0] === command[0]) return effective;
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 1));
    } while (performance.now() < deadline);
    throw new Error("Timeout");
  }

  async function pollRaphnetSILoop(device, reportSize) {
    while (raphnetBridge.running && device && device.opened) {
      for (const port of raphnetBridge.ports) {
        try {
          const reply = await exchangeDevice(device, reportSize, new Uint8Array([REQUEST_RAW_SI, port.channel, 1, N64_GET_STATUS]), 35);
          if (reply.length >= 7 && reply[1] === port.channel && reply[2] === 4) {
            port.button = ((reply[3] << 8) | reply[4]) >>> 0;
            port.stickX = (reply[5] << 24) >> 24;
            port.stickY = (reply[6] << 24) >> 24;
            port.connected = true;
            port.timestamp = performance.now();
          } else if (reply.length >= 3 && reply[1] === port.channel && reply[2] === 0) {
            port.connected = false;
          }
        } catch (_) {}
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

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
      const requested = await navigator.hid.requestDevice({
        filters: RAPHNET_VENDOR_IDS.map((vendorId) => ({ vendorId })),
      });
      if (!requested || !requested.length) return;

      const allDevices = await navigator.hid.getDevices();
      const candidates = allDevices.filter((d) => RAPHNET_VENDOR_IDS.includes(d.vendorId));
      const toOpen = candidates.length ? candidates : requested;

      raphnetBridge.ports = [0, 1, 2, 3].map((channel) => ({
        channel,
        button: 0,
        stickX: 0,
        stickY: 0,
        connected: false,
        timestamp: 0,
      }));

      let vendorSIActive = false;
      for (const dev of toOpen) {
        try {
          if (!dev.opened) await dev.open();
          dev.addEventListener("inputreport", handleRaphnetInputReport);
          raphnetBridge.devices.push(dev);

          for (const size of REPORT_SIZE_CANDIDATES) {
            try {
              const reply = await exchangeDevice(dev, size, new Uint8Array([REQUEST_SUSPEND_POLLING, 0]), 150);
              if (reply[0] === REQUEST_SUSPEND_POLLING) {
                await exchangeDevice(dev, size, new Uint8Array([REQUEST_SUSPEND_POLLING, 1]), 150);
                raphnetBridge.running = true;
                vendorSIActive = true;
                void pollRaphnetSILoop(dev, size);
                break;
              }
            } catch (_) {}
          }
        } catch (e) {
          console.warn("Could not open HID device interface:", e);
        }
      }

      if (!vendorSIActive) {
        raphnetBridge.ports[0].connected = true;
        raphnetBridge.ports[0].timestamp = performance.now();
        raphnetBridge.running = true;
      }

      const btn = document.getElementById("battleship-raphnet-button");
      if (btn) btn.textContent = "🔌 Desconectar Raphnet";
      console.info("Raphnet WebHID connected successfully!", { vendorSIActive, count: raphnetBridge.devices.length });
    } catch (err) {
      console.error("Raphnet connection error:", err);
      alert("Error al conectar Raphnet: " + err.message);
    }
  };

  raphnetBridge.disconnect = async function () {
    raphnetBridge.running = false;
    for (const dev of raphnetBridge.devices) {
      try {
        dev.removeEventListener("inputreport", handleRaphnetInputReport);
        if (dev.opened) {
          try {
            await exchangeDevice(dev, 64, new Uint8Array([REQUEST_SUSPEND_POLLING, 0]), 100);
          } catch (_) {}
          await dev.close();
        }
      } catch (_) {}
    }
    raphnetBridge.devices = [];
    raphnetBridge.ports = [];
    const btn = document.getElementById("battleship-raphnet-button");
    if (btn) btn.textContent = "🔌 Conectar Mando N64 (Raphnet)";
  };

  globalThis.BattleShipRaphnet = raphnetBridge;

  function pumpWebInput() {
    const shared = globalThis.BattleShipWebInputShared;
    if (shared && typeof HEAPU32 !== "undefined") {
      const visibleIds = [];
      let count = 0;
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
        for (const state of direct.ports) {
          if (!state || count >= shared.capacity) continue;
          if (state.connected || (now - state.timestamp < 1000 && state.timestamp > 0)) {
            writePad(state.button >>> 0, state.stickX | 0, state.stickY | 0, true);
            visibleIds.push(`Raphnet Puerto ${state.channel + 1} [Stick: ${state.stickX},${state.stickY} | B: 0x${(state.button || 0).toString(16)}]`);
          }
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
        const down = (pad, index) => !!(pad.buttons[index] && pad.buttons[index].pressed);
        const axis = (pad, index) => Number.isFinite(pad.axes[index])
          ? Math.max(-1, Math.min(1, pad.axes[index])) : 0;
        const stick = (value, deadzone) => Math.abs(value) < deadzone ? 0 : Math.round(value * 80);
        const set = (mask, condition, bit) => condition ? (mask | bit) : mask;

        for (const pad of gamepads) {
          if (!pad || !pad.connected || count >= shared.capacity) continue;
          present.add(pad.index);
          const id = String(pad.id || "");
          const lowerId = id.toLowerCase();
          const raphnet = lowerId.includes("raphnet") || lowerId.includes("289b") ||
                          lowerId.includes("1781") || lowerId.includes("1740") ||
                          lowerId.includes("n64") || lowerId.includes("retro") ||
                          lowerId.includes("mayflash") || lowerId.includes("innext") ||
                          (pad.mapping !== "standard" && pad.buttons.length <= 16);

          let mask = 0;
          if (raphnet) {
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
          } else {
            mask = set(mask, down(pad, 0), 0x8000);
            mask = set(mask, down(pad, 1), 0x4000);
            mask = set(mask, down(pad, 4), 0x0020);
            mask = set(mask, down(pad, 5), 0x0010);
            mask = set(mask, down(pad, 6) || down(pad, 7), 0x2000);
            mask = set(mask, down(pad, 9), 0x1000);
            if (pad.buttons.length >= 16) {
              mask = set(mask, down(pad, 12), 0x0800);
              mask = set(mask, down(pad, 13), 0x0400);
              mask = set(mask, down(pad, 14), 0x0200);
              mask = set(mask, down(pad, 15), 0x0100);
            }
            if (pad.axes.length >= 4) {
              const rightX = axis(pad, 2);
              const rightY = axis(pad, 3);
              if (Math.abs(rightY) > 0.6) {
                mask = set(mask, rightY < -0.6, 0x0008);
                mask = set(mask, rightY > 0.6, 0x0004);
              }
              if (Math.abs(rightX) > 0.6) {
                mask = set(mask, rightX < -0.6, 0x0002);
                mask = set(mask, rightX > 0.6, 0x0001);
              }
            }
          }
          const deadzone = raphnet ? 0.06 : 0.20;
          const sx = stick(axis(pad, 0), deadzone);
          const sy = stick(-axis(pad, 1), deadzone);
          writePad(mask, sx, sy, raphnet);
          const pressedBtns = [];
          for (let b = 0; b < pad.buttons.length; b++) {
            if (down(pad, b)) pressedBtns.push(`B${b}`);
          }
          visibleIds.push(`${id || "Mando"} [Stick: ${sx},${sy} | ${pressedBtns.join(",") || "reposo"}]`);
        }
        for (const index of Array.from(activeRaphnetGamepads)) {
          if (!present.has(index)) activeRaphnetGamepads.delete(index);
        }

        if (count === 0 && webKeyboardKeys.size > 0) {
          let mask = 0;
          const held = (code) => webKeyboardKeys.has(code);
          if (held("KeyX")) mask |= 0x8000; // A
          if (held("KeyC")) mask |= 0x4000; // B
          if (held("KeyZ")) mask |= 0x2000; // Z
          if (held("Space")) mask |= 0x1000; // Start
          if (held("KeyE")) mask |= 0x0020; // L
          if (held("KeyR")) mask |= 0x0010; // R
          if (held("ArrowUp")) mask |= 0x0800; // D-Up
          if (held("ArrowDown")) mask |= 0x0400; // D-Down
          if (held("ArrowLeft")) mask |= 0x0200; // D-Left
          if (held("ArrowRight")) mask |= 0x0100; // D-Right
          const stickX = (held("KeyD") ? 80 : 0) - (held("KeyA") ? 80 : 0);
          const stickY = (held("KeyW") ? 80 : 0) - (held("KeyS") ? 80 : 0);
          writePad(mask, stickX, stickY, false);
          visibleIds.push(`Teclado [Stick: ${stickX},${stickY} | ${Array.from(webKeyboardKeys).join(",")}]`);
        }

        HEAPU32[shared.countPointer >> 2] = count;
        globalThis.BattleShipWebInputState = {
          connected: count,
          ids: visibleIds,
          rawGamepadCount: gamepads.filter(Boolean).length,
          timestamp: performance.now()
        };
      }
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
    const raphnetButton = document.createElement("button");
    raphnetButton.id = "battleship-raphnet-button";
    raphnetButton.textContent = "🔌 Conectar Mando N64 (Raphnet)";
    raphnetButton.style.cssText = "margin-left:8px;padding:4px 10px;cursor:pointer;font-weight:600;background:#2b5c3b;color:#fff;border:1px solid #4caf50;border-radius:4px;";
    raphnetButton.onclick = async () => {
      const raph = globalThis.BattleShipRaphnet;
      if (raph && typeof raph.connect === "function") {
        await raph.connect();
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
      if (connected > 0 && state.ids && state.ids.length) {
        status.textContent = state.ids.join(" | ");
        status.style.color = "#8ff0a4";
      } else if (state && state.rawGamepadCount > 0) {
        status.textContent = `${state.rawGamepadCount} dispositivo(s) detectado(s) — Pulsa un botón en el mando`;
        status.style.color = "#ffeb3b";
      } else {
        status.textContent = "Mando no detectado — Pulsa un botón (o usa teclado: WASD / X,C,Z, Espacio)";
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
