package client

import (
	"io"

	"github.com/gorilla/websocket"
)

type TTY struct {
	conn *websocket.Conn
	buf  []byte
}

func (c *Client) OpenTTY(agentID string) (*TTY, error) {
	conn, _, err := websocket.DefaultDialer.Dial(c.wsURL("/tty/"+agentID), c.wsHeaders())
	if err != nil {
		return nil, err
	}
	return &TTY{conn: conn}, nil
}

func (t *TTY) Read(p []byte) (int, error) {
	for len(t.buf) == 0 {
		typ, data, err := t.conn.ReadMessage()
		if err != nil {
			return 0, err
		}
		if typ == websocket.BinaryMessage || typ == websocket.TextMessage {
			t.buf = data
		}
	}
	n := copy(p, t.buf)
	t.buf = t.buf[n:]
	return n, nil
}

func (t *TTY) Write(p []byte) (int, error) {
	if err := t.conn.WriteMessage(websocket.BinaryMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (t *TTY) Close() error {
	return t.conn.Close()
}

var _ io.ReadWriteCloser = (*TTY)(nil)
