package client

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type TaggedEvent struct {
	ID      string          `json:"id"`
	TS      string          `json:"ts"`
	Tags    []string        `json:"tags"`
	Payload json.RawMessage `json:"payload"`
}

func (e TaggedEvent) Type() string {
	var payload struct {
		Type string `json:"type"`
	}
	_ = json.Unmarshal(e.Payload, &payload)
	return payload.Type
}

func (c *Client) SubscribeEvents(out chan<- TaggedEvent) {
	for {
		conn, _, err := websocket.DefaultDialer.Dial(c.wsURL("/events"), c.wsHeaders())
		if err != nil {
			time.Sleep(time.Second)
			continue
		}
		for {
			var event TaggedEvent
			if err := conn.ReadJSON(&event); err != nil {
				_ = conn.Close()
				break
			}
			out <- event
		}
		time.Sleep(time.Second)
	}
}

func (c *Client) wsURL(path string) string {
	u, err := url.Parse(c.BaseURL)
	if err != nil {
		return path
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	default:
		u.Scheme = "ws"
	}
	u.Path = strings.TrimRight(u.Path, "/") + path
	return u.String()
}

func (c *Client) wsHeaders() http.Header {
	headers := http.Header{}
	if c.Token != "" {
		headers.Set("x-orquesta-token", c.Token)
	}
	return headers
}
