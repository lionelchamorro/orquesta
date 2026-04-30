package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Client struct {
	BaseURL string
	Root    string
	Token   string
	http    *http.Client
}

type Plan struct {
	RunID            string `json:"runId"`
	Status           string `json:"status"`
	CurrentIteration int    `json:"current_iteration"`
	MaxIterations    int    `json:"max_iterations"`
}


type Subtask struct {
	ID      string `json:"id"`
	TaskID  string `json:"taskId"`
	Role    string `json:"role"`
	Status  string `json:"status"`
	AgentID string `json:"agentId"`
}

type Agent struct {
	ID            string   `json:"id"`
	Role          string   `json:"role"`
	CLI           string   `json:"cli"`
	Model         string   `json:"model"`
	Status        string   `json:"status"`
	BoundTask     string   `json:"bound_task"`
	BoundSubtask  string   `json:"bound_subtask"`
	SessionCWD    string   `json:"session_cwd"`
	StartedAt     string   `json:"started_at"`
	FinishedAt    string   `json:"finished_at"`
	LastActivity  string   `json:"last_activity_at"`
	LastEventAt   string   `json:"last_event_at"`
	CLISessionID  string   `json:"cli_session_id"`
	ExitCode      *int     `json:"exit_code,omitempty"`
	StopReason    string   `json:"stop_reason"`
	TotalCostUSD  *float64 `json:"total_cost_usd,omitempty"`
	DurationMS    *int64   `json:"duration_ms,omitempty"`
	NumTurns      *int     `json:"num_turns,omitempty"`
}

type Task struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Status       string   `json:"status"`
	Iteration    int      `json:"iteration"`
	Subtasks     []string `json:"subtasks"`
	WorktreePath string   `json:"worktree_path"`
}

type Iteration struct {
	ID      string `json:"id"`
	Number  int    `json:"number"`
	Trigger string `json:"trigger"`
}

type RunState struct {
	Plan           Plan        `json:"plan"`
	Tasks          []Task      `json:"tasks"`
	Subtasks       []Subtask   `json:"subtasks"`
	Agents         []Agent     `json:"agents"`
	Iterations     []Iteration `json:"iterations"`
	PlannerAgentID string      `json:"plannerAgentId"`
}

func New(baseURL, root string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Root:    root,
		Token:   readToken(root),
		http:    &http.Client{Timeout: 15 * time.Second},
	}
}

func readToken(root string) string {
	data, err := os.ReadFile(filepath.Join(root, ".orquesta", "crew", "session.token"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func (c *Client) newRequest(method, path string, body []byte) (*http.Request, error) {
	req, err := http.NewRequest(method, c.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if c.Token != "" {
		req.Header.Set("x-orquesta-token", c.Token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}

func (c *Client) GetRunsCurrent() (RunState, error) {
	req, err := c.newRequest(http.MethodGet, "/api/runs/current", nil)
	if err != nil {
		return RunState{}, err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return RunState{}, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return RunState{}, fmt.Errorf("GET /api/runs/current: %s", res.Status)
	}
	var state RunState
	return state, json.NewDecoder(res.Body).Decode(&state)
}

func (c *Client) PostApprove() error {
	return c.post("/api/approve", nil)
}

func (c *Client) PostPlanReset() error {
	return c.post("/api/plan/reset", nil)
}

func (c *Client) PostAgentInput(agentID, text string) error {
	body, err := json.Marshal(map[string]string{"text": text, "role": "pm"})
	if err != nil {
		return err
	}
	return c.post("/api/agents/"+agentID+"/input", body)
}

func (c *Client) post(path string, body []byte) error {
	req, err := c.newRequest(http.MethodPost, path, body)
	if err != nil {
		return err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("POST %s: %s", path, res.Status)
	}
	return nil
}
