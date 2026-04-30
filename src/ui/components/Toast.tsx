import { useState } from "react";
import type { BusEvent, TaggedBusEvent } from "../../core/types";
import { DAEMON_HTTP } from "../config";

const isFallbackAsk = (payload: BusEvent): payload is Extract<BusEvent, { type: "ask_user" }> =>
  payload.type === "ask_user" && payload.fallback === true;

export function Toast({ events }: { events: TaggedBusEvent[] }) {
  const [value, setValue] = useState("");
  const ask = [...events].reverse().find((event) => isFallbackAsk(event.payload));
  if (!ask || !isFallbackAsk(ask.payload)) return null;
  const askPayload = ask.payload;

  const answer = async (submitted: string) => {
    if (!submitted.trim()) return;
    await fetch(`${DAEMON_HTTP}/api/ask/${askPayload.askId}/answer`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: submitted }),
    });
    setValue("");
  };

  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, width: 320 }} className="panel">
      <div className="topbar"><strong>Question pending</strong></div>
      <div className="list">
        <div>{askPayload.question}</div>
        {askPayload.options && askPayload.options.length > 0 ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {askPayload.options.map((option) => (
              <button key={option} onClick={() => answer(option)}>{option}</button>
            ))}
          </div>
        ) : (
          <>
            <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Write an answer" />
            <button onClick={() => answer(value)}>Reply</button>
          </>
        )}
      </div>
    </div>
  );
}
