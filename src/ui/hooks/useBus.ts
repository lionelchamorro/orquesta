import { useEffect, useState } from "react";
import type { TaggedBusEvent } from "../../core/types";
import { DAEMON_WS } from "../config";

export const useBus = () => {
  const [events, setEvents] = useState<TaggedBusEvent[]>([]);

  useEffect(() => {
    let closed = false;
    let retry = 500;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const connect = () => {
      const target = DAEMON_WS || `${proto}://${location.host}`;
      ws = new WebSocket(`${target}/events`);
      ws.onopen = () => {
        retry = 500;
      };
      ws.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as TaggedBusEvent;
        setEvents((current) => [...current.slice(-199), event]);
      };
      ws.onclose = () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, retry);
        retry = Math.min(retry * 2, 10_000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return events;
};
