import { useState } from "react";

export function ChatComposer({
  targetAgentId,
  label = "as PM",
  placeholder = "@coder use 'rebase' — or /broadcast ...",
}: {
  targetAgentId?: string;
  label?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");

  const send = async () => {
    if (!targetAgentId || !value.trim()) return;
    await fetch(`/api/agents/${targetAgentId}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `[human/pm]: ${value}`, role: "pm" }),
    });
    setValue("");
  };

  return (
    <div className="panel">
      <div className="composer">
        <span className="badge">{label}</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void send(); }}
          placeholder={placeholder}
        />
        <button onClick={send}>Send</button>
      </div>
    </div>
  );
}
