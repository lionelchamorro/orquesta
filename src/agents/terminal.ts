const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;

export class AgentTerminal {
  private pty: Bun.Terminal;
  private proc: Bun.Subprocess;
  private cols = DEFAULT_COLS;
  private rows = DEFAULT_ROWS;

  constructor(
    public readonly agentId: string,
    public readonly cmd: string[],
    public readonly cwd: string,
    public readonly onData: (chunk: Uint8Array) => void,
    private readonly env: Record<string, string> = {},
  ) {
    this.pty = new Bun.Terminal({
      cols: this.cols,
      rows: this.rows,
      data: (_terminal, data) => {
        this.onData(data);
      },
    });

    this.proc = Bun.spawn(cmd, {
      cwd,
      terminal: this.pty,
      env: {
        ...process.env,
        ...env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });
  }

  write(data: string | Uint8Array) {
    this.pty.write(data);
  }

  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.pty.resize(cols, rows);
  }

  getViewport(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  kill(signal: string | number = "SIGHUP") {
    this.proc.kill(signal as never);
  }

  get exited() {
    return this.proc.exited;
  }
}
