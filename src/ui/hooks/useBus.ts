import { useEffect, useState } from "react";
import type { TaggedBusEvent } from "../../core/types";

export const useBus = () => {
  const [events, setEvents] = useState<TaggedBusEvent[]>([]);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/events`);
    ws.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as TaggedBusEvent;
      setEvents((current) => [...current.slice(-199), event]);
    };
    return () => ws.close();
  }, []);

  return events;
};
