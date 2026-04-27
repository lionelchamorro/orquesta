export class AgentTerminal {
  private terminal: Bun.Terminal;
  private proc: Bun.Subprocess;

  constructor(
    public readonly agentId: string,
    public readonly cmd: string[],
    public readonly cwd: string,
    public readonly onData: (chunk: Uint8Array) => void,
    private readonly env: Record<string, string> = {},
  ) {
    this.terminal = new Bun.Terminal({
      cols: 100,
      rows: 30,
      data: (_terminal, data) => this.onData(data),
    });

    this.proc = Bun.spawn(cmd, {
      cwd,
      terminal: this.terminal,
      env: {
        ...process.env,
        ...env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });
  }

  write(data: string | Uint8Array) {
    this.terminal.write(data);
  }

  resize(cols: number, rows: number) {
    this.terminal.resize(cols, rows);
  }

  kill(signal: string | number = "SIGHUP") {
    this.proc.kill(signal as never);
  }

  get exited() {
    return this.proc.exited;
  }
}
