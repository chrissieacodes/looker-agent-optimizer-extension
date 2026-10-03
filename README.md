# Agent Optimizer - Looker Extension Framework

This application is a full **Looker Extension Framework** application built from the `agent-optimizer` data app. Unlike sandboxed dashboard tile data apps, this extension has full **Looker Core 4.0 API entitlements** to directly interact with, modify, and optimize real Looker AI agents in real time.

---

## Key Features

1. **Live Agent Management via Looker API**:
   - Fetches real agents dynamically (`search_agents` / `GET /api/4.0/agents/search`).
   - Edits agent configuration: Name, Description, Code Interpreter toggle, and Linked Explores (`sources`).
   - Edits Agent Instructions (prompt engineering).
   - **Direct Updates**: Saves edits directly into Looker using `update_agent` (`PATCH /api/4.0/agents/{agent_id}`).

2. **Live Agent Testing & Preview Chat**:
   - Initiates real agent conversations via `create_conversation` (`POST /api/4.0/conversations`).
   - Dispatches user prompts and streams responses using `conversational_analytics_chat` (`POST /api/4.0/conversational_analytics/chat`).
   - Allows instant verification of how instruction updates affect agent outputs.

3. **Telemetry & Feedback Analytics**:
   - Queries `system__activity.conversations_feedback` via `run_inline_query`.
   - Tracks KPIs: Total Conversations, Average Latency, User Feedback Ratings, and Token Usage.
   - Interactive grid showing real message logs, latency, and health badges.

4. **Autonomous Vertex AI Instruction Optimizer**:
   - Hosted on GCP project: `cloud-looker-devrel-demos` (location: `us-central1`).
   - Powered by **Gemini 2.5 Flash** (configurable via `GEMINI_MODEL`).
   - Autonomously analyzes telemetry and negative user ratings against agent prompt instructions.
   - Generates performance scores, feedback themes, root cause analysis, and one-click applicable prompt rewrites.

5. **Actions & Monitoring Hub**:
   - Monitors integration states and Looker Actions (Slack alerts, ActionHub pipelines).
   - Analysis hub for unstructured user sentiment and latency spike trends.

---

## Looker CLI (`looker-cli`)

As part of this setup, the official Go-based **Looker CLI** (`looker-cli` v0.4.8) has been compiled from [`looker-open-source/looker-cli`](https://github.com/looker-open-source/looker-cli) and installed in your user PATH at:
`/usr/local/google/home/chrissiea/.local/bin/looker-cli`

A `default` profile has been configured using your local credentials from `data-apps-config.json`.

### CLI Recipes

#### 1. Search Real Agents
```bash
looker-cli api conversationalanalytics search_agents --limit 5
```

#### 2. Get Details of a Specific Agent
```bash
looker-cli api conversationalanalytics get_agent <AGENT_ID>
```

#### 3. Update an Agent from the CLI
Generate the JSON payload template:
```bash
looker-cli api conversationalanalytics update_agent --template
```
Submit the update directly:
```bash
cat << 'JSON' | looker-cli api conversationalanalytics update_agent <AGENT_ID> -
{
  "name": "Updated Agent Name",
  "description": "Updated agent description",
  "context": {
    "instructions": "Be concise, answer with bulleted executive summaries."
  }
}
JSON
```

#### 4. Query Telemetry with `run_inline_query`
```bash
echo '{"model":"system__activity","view":"conversations_feedback","fields":["agent.name","conversation.count"],"limit":"5"}' | looker-cli api query run_inline_query json -
```

---

## Extension Structure

```
agent-optimizer-extension/
├── manifest.lkml             # LookML application definition with API entitlements
├── package.json              # Extension dependencies & scripts
├── webpack.config.js         # Webpack bundle & HMR dev server configuration
├── src/
│   ├── index.jsx             # DOM entry point wrapping <ExtensionProvider40>
│   ├── App.jsx               # Main React application with 3 tabs & dark mode
│   └── services/
│       └── agentService.js   # Looker 4.0 API service (agents, chat, telemetry)
└── dist/
    └── bundle.js             # Production bundled JavaScript
```

---

## Local Development & Deployment

### 1. Start Local Development Server
```bash
cd agent-optimizer-extension
yarn develop
```
This runs the development server at `http://localhost:8080/bundle.js` with hot module reloading.

### 2. Configure LookML Manifest
Copy the contents of `manifest.lkml` into your LookML project manifest in Looker:
```lookml
project_name: "agent_optimizer"

application: agent_optimizer {
  label: "Agent Feedback Optimizer"
  url: "http://localhost:8080/bundle.js"
  entitlements: {
    core_api_methods: [
      "me",
      "all_lookml_models",
      "run_inline_query",
      "search_agents",
      "get_agent",
      "update_agent",
      "create_agent",
      "delete_agent",
      "create_conversation",
      "search_conversations",
      "get_conversation",
      "conversational_analytics_chat",
      "create_golden_query",
      "update_golden_query",
      "delete_golden_query",
      "all_conversation_messages"
    ]
    use_embeds: yes
    use_form_submit: yes
    use_clipboard: yes
    navigation: yes
    new_window: yes
  }
}
```

### 3. Build Production Bundle
To deploy as a hosted file in Looker:
```bash
yarn build
```
Upload `dist/bundle.js` to your LookML project and update `manifest.lkml` to reference:
```lookml
file: "bundle.js"
```
