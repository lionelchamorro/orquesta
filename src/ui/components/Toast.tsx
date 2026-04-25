import { useState } from "react";
import type { TaggedBusEvent } from "../../core/types";

export function Toast({ events }: { events: TaggedBusEvent[] }) {
  const [value, setValue] = useState("");
  const ask = [...events].reverse().find((event) => event.payload.type === "ask_user" && event.payload.fallback);
  if (!ask || ask.payload.type !== "ask_user") return null;

  const answer = async (submitted: string) => {
    if (!submitted.trim()) return;
    await fetch(`/api/ask/${ask.payload.askId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: submitted }),
    });
    setValue("");
  };

  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, width: 320 }} className="panel">
      <div className="topbar"><strong>Question pending</strong></div>
      <div className="list">
        <div>{ask.payload.question}</div>
        {ask.payload.options && ask.payload.options.length > 0 ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ask.payload.options.map((option) => (
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
