import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import "@xterm/xterm/css/xterm.css";

type Props = { wsUrl?: string; className?: string; readOnly?: boolean };

export default function WebTTY({ wsUrl = "/ws", className, readOnly = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XTerm({
      // cursorBlink: !readOnly,
      // disableStdin: readOnly,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", Menlo, monospace',
      fontSize: 14,
      theme: { background: "#0e0b1a", foreground: "#e6e0ff", cursor: "#E3FF37" },
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new ClipboardAddon());
    term.open(host);
    try { fit.fit(); } catch {}
    if (!readOnly) term.focus();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = wsUrl.startsWith("ws") ? wsUrl : `${proto}://${location.host}${wsUrl}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const enc = new TextEncoder();

    const sendResize = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onopen = () => {
      try { fit.fit(); } catch {}
      sendResize();
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(ev.data));
        return;
      }
      term.write(ev.data as string);
    };
    ws.onclose = () => term.write("\r\n\x1b[31m[connection closed]\x1b[0m\r\n");

    const dataDisp = term.onData((d) => {
      if (readOnly) return;
      if (ws.readyState === WebSocket.OPEN) ws.send(enc.encode(d));
    });
    const resizeDisp = term.onResize(sendResize);

    // Only refit on actual window resizes. A ResizeObserver on the host fires
    // on every neighbouring-panel reflow inside the dashboard grid, which
    // triggered fit.fit() → resize → PTY redraw → flicker on every bus event.
    const refit = () => { try { fit.fit(); } catch {} };
    window.addEventListener("resize", refit);

    return () => {
      dataDisp.dispose();
      resizeDisp.dispose();
      window.removeEventListener("resize", refit);
      try { ws.close(); } catch {}
      term.dispose();
    };
  }, [wsUrl, readOnly]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ height: "100%", width: "100%", background: "#0e0b1a", boxSizing: "border-box" }}
    />
  );
}
