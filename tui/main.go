package main

import (
	"log"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/lionelchamorro/orquesta/tui/internal/client"
	"github.com/lionelchamorro/orquesta/tui/internal/ui"
)

func main() {
	baseURL := os.Getenv("ORQ_DAEMON_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8000"
	}
	cwd, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	api := client.New(baseURL, cwd)
	events := make(chan client.TaggedEvent, 64)
	go api.SubscribeEvents(events)

	program := tea.NewProgram(ui.NewHome(api, events), tea.WithAltScreen())
	if _, err := program.Run(); err != nil {
		log.Fatal(err)
	}
}
