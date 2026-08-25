(function () {
  "use strict";

  // Emscripten includes --pre-js in both the page runtime and its pthread
  // workers. WebHID and the connection panel belong only to the browser
  // window; workers have no document and must leave immediately.
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const RAPHNET_VENDOR_IDS = [0x289b, 0x1781, 0x1740];
  const REPORT_SIZE_CANDIDATES = [63, 32];
  const REQUEST_SUSPEND_POLLING = 0x03;
  const REQUEST_GET_VERSION = 0x04;
  const REQUEST_GET_CONTROLLER_TYPE = 0x06;
  const REQUEST_RAW_SI = 0x80;
  const N64_GET_STATUS = 0x01;

  const bridge = {
    device: null,
    reportSize: 0,
    ports: [],
    running: false,
    statusElement: null,
    buttonElement: null,
    errorCount: 0,
  };

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  function setStatus(message, kind) {
    if (!bridge.statusElement) {
      return;
    }
    bridge.statusElement.textContent = message;
    bridge.statusElement.style.color = kind === "error" ? "#ff8c8c" : kind === "ok" ? "#8ff0a4" : "#e6e6e6";
  }

  function responseBytes(dataView, expectedOpcode) {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    if (bytes.length > 1 && bytes[0] === 0 && bytes[1] === expectedOpcode) {
      return bytes.slice(1);
    }
    return bytes;
  }

  async function exchange(command, timeoutMilliseconds) {
    if (!bridge.device || !bridge.device.opened || bridge.reportSize <= 0) {
      throw new Error("Raphnet no está abierto");
    }

    const output = new Uint8Array(bridge.reportSize);
    output.set(command.slice(0, bridge.reportSize));
    await bridge.device.sendFeatureReport(0, output);

    const deadline = performance.now() + timeoutMilliseconds;
    do {
      const dataView = await bridge.device.receiveFeatureReport(0);
      const bytes = responseBytes(dataView, command[0]);
      if (bytes.length > 0 && bytes[0] === command[0]) {
        return bytes;
      }
      await wait(1);
    } while (performance.now() < deadline);

    throw new Error(`Raphnet no respondió al comando 0x${command[0].toString(16)}`);
  }

  async function chooseReportSize() {
    for (const candidate of REPORT_SIZE_CANDIDATES) {
      bridge.reportSize = candidate;
      try {
        const reply = await exchange(new Uint8Array([REQUEST_SUSPEND_POLLING, 0]), 250);
        if (reply[0] === REQUEST_SUSPEND_POLLING) {
          return candidate;
        }
      } catch (error) {
        console.warn(`BattleShip Raphnet: report size ${candidate} rejected`, error);
      }
    }
    bridge.reportSize = 0;
    throw new Error("La interfaz seleccionada no acepta comandos Raphnet");
  }

  async function findN64Channels() {
    const channels = [];
    for (let channel = 0; channel < 4; channel += 1) {
      try {
        const reply = await exchange(
          new Uint8Array([REQUEST_GET_CONTROLLER_TYPE, channel]),
          150,
        );
        if (reply.length >= 3 && reply[1] === channel && reply[2] === 1) {
          channels.push(channel);
        }
      } catch (error) {
        console.debug(`BattleShip Raphnet: channel ${channel} type unavailable`, error);
      }
    }

    // Older firmware may not implement GET_CONTROLLER_TYPE. Probe RAW_SI so
    // those adapters can still participate without pretending empty channels
    // are connected.
    if (channels.length === 0) {
      for (let channel = 0; channel < 4; channel += 1) {
        try {
          const reply = await exchange(
            new Uint8Array([REQUEST_RAW_SI, channel, 1, N64_GET_STATUS]),
            150,
          );
          if (reply.length >= 7 && reply[1] === channel && reply[2] === 4) {
            channels.push(channel);
          }
        } catch (error) {
          console.debug(`BattleShip Raphnet: channel ${channel} RAW_SI unavailable`, error);
        }
      }
    }
    return channels;
  }

  async function pollOnce() {
    for (const port of bridge.ports) {
      try {
        const reply = await exchange(
          new Uint8Array([REQUEST_RAW_SI, port.channel, 1, N64_GET_STATUS]),
          50,
        );
        if (reply.length >= 7 && reply[1] === port.channel && reply[2] === 4) {
          port.button = ((reply[3] << 8) | reply[4]) >>> 0;
          port.stickX = (reply[5] << 24) >> 24;
          port.stickY = (reply[6] << 24) >> 24;
          port.connected = true;
          port.timestamp = performance.now();
          bridge.errorCount = 0;
        }
      } catch (error) {
        bridge.errorCount += 1;
        if (bridge.errorCount === 1 || bridge.errorCount % 60 === 0) {
          console.warn("BattleShip Raphnet: poll failed", error);
        }
      }
    }
  }

  async function pollLoop() {
    while (bridge.running && bridge.device && bridge.device.opened) {
      await pollOnce();
      await nextFrame();
    }
  }

  async function disconnect() {
    bridge.running = false;
    const device = bridge.device;
    bridge.device = null;
    bridge.ports = [];
    if (device && device.opened) {
      try {
        bridge.device = device;
        await exchange(new Uint8Array([REQUEST_SUSPEND_POLLING, 0]), 150);
      } catch (error) {
        console.debug("BattleShip Raphnet: could not resume adapter polling", error);
      } finally {
        bridge.device = null;
      }
      try {
        await device.close();
      } catch (error) {
        console.debug("BattleShip Raphnet: close failed", error);
      }
    }
    bridge.reportSize = 0;
    if (bridge.buttonElement) {
      bridge.buttonElement.textContent = "Conectar Raphnet Direct";
    }
    setStatus("Mando directo desconectado. Puedes usar un mando estándar.", "info");
  }

  async function connect() {
    if (bridge.running) {
      await disconnect();
      return;
    }
    if (!("hid" in navigator)) {
      setStatus("WebHID no está disponible. Usa Chrome o Edge.", "error");
      return;
    }

    try {
      setStatus("Selecciona la interfaz Raphnet en la ventana del navegador…", "info");
      const devices = await navigator.hid.requestDevice({
        filters: RAPHNET_VENDOR_IDS.map((vendorId) => ({ vendorId })),
      });
      if (!devices.length) {
        setStatus("No se seleccionó ningún adaptador.", "info");
        return;
      }

      const device = devices[0];
      await device.open();
      bridge.device = device;
      await chooseReportSize();

      try {
        const version = await exchange(new Uint8Array([REQUEST_GET_VERSION]), 300);
        console.info("BattleShip Raphnet: firmware reply", Array.from(version));
      } catch (error) {
        console.warn("BattleShip Raphnet: firmware version unavailable", error);
      }

      await exchange(new Uint8Array([REQUEST_SUSPEND_POLLING, 1]), 250);
      const channels = await findN64Channels();
      if (!channels.length) {
        throw new Error("No se encontró un mando N64 conectado al adaptador");
      }

      bridge.ports = channels.slice(0, 4).map((channel) => ({
        channel,
        button: 0,
        stickX: 0,
        stickY: 0,
        connected: false,
        timestamp: 0,
      }));
      bridge.running = true;
      bridge.buttonElement.textContent = "Desconectar Raphnet";
      setStatus(`Raphnet Direct conectado: ${bridge.ports.length} mando(s) N64.`, "ok");
      console.info("BattleShip Raphnet Direct connected", {
        productName: device.productName,
        vendorId: device.vendorId,
        productId: device.productId,
        channels,
        reportSize: bridge.reportSize,
      });
      void pollLoop();
    } catch (error) {
      console.error("BattleShip Raphnet Direct connection failed", error);
      const message = `${error.message}. Si aparecen varias opciones, elige la interfaz HID del fabricante.`;
      await disconnect();
      setStatus(message, "error");
    }
  }

  function fitCanvasAfterLayout() {
    const schedule = globalThis.BattleShipScheduleCanvasFit;
    if (typeof schedule === "function") {
      schedule();
      return;
    }
    const fit = globalThis.BattleShipFitCanvas;
    if (typeof fit !== "function") {
      return;
    }
    fit();
    window.requestAnimationFrame(() => {
      fit();
      window.requestAnimationFrame(fit);
    });
    window.setTimeout(fit, 150);
  }

  async function toggleFullscreen() {
    const canvas = document.getElementById("canvas");
    if (!canvas) {
      return;
    }
    const fullscreenHost = canvas.parentElement || canvas;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        // Fullscreen a container rather than the canvas itself. Browsers place
        // a fullscreen canvas at the top-left of the top layer and can ignore
        // its centering transform. A flex container keeps the 4:3 canvas
        // centered and lets us leave the WebGL backing size untouched.
        await fullscreenHost.requestFullscreen({ navigationUI: "hide" });
      }
    } catch (error) {
      console.error("BattleShip fullscreen failed", error);
    } finally {
      fitCanvasAfterLayout();
    }
  }

  function installFullscreenControl() {
    const button = Array.from(document.querySelectorAll('input[type="button"]'))
      .find((element) => element.value === "Fullscreen");
    if (!button || button.dataset.battleshipFullscreen === "true") {
      return;
    }

    // The stock Emscripten fullscreen helper resizes and reparents the SDL
    // canvas. BattleShip keeps a fixed 1280x960 WebGL backing store, so that
    // helper can invalidate the visible surface when fullscreen is exited.
    // Fullscreen the canvas directly and change only its CSS presentation.
    button.dataset.battleshipFullscreen = "true";
    button.value = "Pantalla completa";
    button.onclick = (event) => {
      event.preventDefault();
      void toggleFullscreen();
      return false;
    };
  }

  function createPanel() {
    if (document.getElementById("battleship-input-panel")) {
      return;
    }
    const panel = document.createElement("section");
    panel.id = "battleship-input-panel";
    panel.style.cssText = [
      "position:fixed",
      "right:10px",
      "bottom:10px",
      "z-index:10000",
      "max-width:300px",
      "padding:10px",
      "border:1px solid #555",
      "border-radius:10px",
      "background:rgba(18,18,22,.94)",
      "color:#fff",
      "font:14px/1.35 system-ui,sans-serif",
      "box-shadow:0 8px 30px rgba(0,0,0,.4)",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px";

    const title = document.createElement("strong");
    title.textContent = "Controles de BattleShip";

    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.textContent = "−";
    collapse.title = "Minimizar controles";
    collapse.style.cssText = "padding:0 7px;cursor:pointer;font-size:18px;line-height:22px";

    const contents = document.createElement("div");
    contents.style.marginTop = "8px";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Conectar Raphnet Direct";
    button.style.cssText = "padding:8px 12px;margin-bottom:8px;cursor:pointer;font-weight:600";
    button.addEventListener("click", () => void connect());

    const status = document.createElement("div");
    status.textContent = "Para un mando estándar, pulsa cualquier botón. Para acceso directo, usa el botón superior.";

    collapse.addEventListener("click", () => {
      const collapsed = contents.hidden;
      contents.hidden = !collapsed;
      collapse.textContent = collapsed ? "−" : "+";
      collapse.title = collapsed ? "Minimizar controles" : "Mostrar controles";
    });
    header.append(title, collapse);
    contents.append(button, status);
    panel.append(header, contents);
    document.body.appendChild(panel);
    bridge.buttonElement = button;
    bridge.statusElement = status;
    installFullscreenControl();

    window.addEventListener("gamepadconnected", (event) => {
      if (!bridge.running) {
        setStatus(`Mando estándar detectado: ${event.gamepad.id}`, "ok");
      }
    });
    window.addEventListener("gamepaddisconnected", () => {
      if (!bridge.running) {
        setStatus("Mando estándar desconectado.", "info");
      }
    });
    document.addEventListener("fullscreenchange", () => {
      panel.style.display = document.fullscreenElement ? "none" : "block";
      const fullscreenButton = document.querySelector('[data-battleship-fullscreen="true"]');
      if (fullscreenButton) {
        fullscreenButton.value = document.fullscreenElement ? "Salir de pantalla completa" : "Pantalla completa";
      }
      fitCanvasAfterLayout();
    });

    if (!("hid" in navigator)) {
      button.disabled = true;
      setStatus("Raphnet Direct requiere Chrome o Edge; el modo estándar sigue disponible.", "info");
    }
  }

  globalThis.BattleShipRaphnet = bridge;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createPanel, { once: true });
  } else {
    createPanel();
  }
  window.addEventListener("pagehide", () => {
    if (bridge.running) {
      void disconnect();
    }
  });
})();
