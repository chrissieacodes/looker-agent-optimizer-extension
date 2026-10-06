# Looker Agent Optimizer Extension

A **Looker Extension Framework** application designed for AI Agent Owners and Analysts to continuously monitor, evaluate, and autonomously optimize Looker AI Agents.

The extension leverages **100% in-database BigQuery ML (`ML.GENERATE_TEXT`)** via Looker Core API methods (`create_sql_query` & `run_sql_query`) following the Looker Explore Assistant architectural pattern. **Zero external proxy servers, zero Docker containers, and zero third-party webhooks are required.**

---

## 🚀 Key Capabilities

1. **Telemetry & Feedback Triage (Tab 1)**:
   - Queries `system__activity.conversations_feedback` in real time.
   - Dynamic KPIs: Engagement Rate, Negative Feedback %, Median Latency, and Token Consumption.
   - Filterable, paginated log grid displaying user prompts, agent answers, and ratings (👍 / 👎).

2. **Autonomous BQML Recommendation Agent (Tab 2)**:
   - Diagnoses prompt gaps, date ambiguities, unmapped terminology, and explore limitations.
   - Synthesizes actionable recommendations, root-cause analyses, and full prompt rewrites.
   - Includes one-click **"Apply to Agent"** to test and deploy improvements.

3. **Live Prompt Engineering & Chat Sandbox (Tab 3)**:
   - Edit agent name, description, system instructions, and linked explores.
   - Interactive preview chat powered by Looker's `conversational_analytics_chat` Core API.
   - One-click **"Save to Looker"** commits changes directly via `PATCH /api/4.0/agents/{id}`.

4. **Action Hub & Alerting (Tab 4)**:
   - Dispatch feedback summaries and optimization plans to Slack channels, Email, or Webhooks.
   - Configure threshold-based negative feedback alerts.

5. **Benchmark Evals (Tab 5)**:
   - Benchmark agent response accuracy and hallucination rates against golden queries.

6. **Enterprise Architecture & Governance (Tab 6)**:
   - Comprehensive living spec covering IAM permissions, Looker database connections, and API contract references.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│               Looker Extension Framework               │
│  (React 17 + Looker Components + Extension SDK 4.0)    │
└───────────────────────────┬────────────────────────────┘
                            │ Core SDK (create_sql_query / run_sql_query)
                            ▼
┌────────────────────────────────────────────────────────┐
│               Looker Core 4.0 API                      │
│      (Executes queries over native connection)         │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│            Google BigQuery ML (BQML)                   │
│   SELECT ml_generate_text_llm_result FROM              │
│   ML.GENERATE_TEXT(MODEL `your_project.dataset.model`) │
└────────────────────────────────────────────────────────┘
```

- **In-Database Inference**: All LLM prompt evaluations run inside BigQuery via remote models connected to Vertex AI.
- **Enterprise Security**: Adheres to native Looker RBAC and BigQuery dataset IAM. No tokens or credentials leave your Google Cloud boundary.

---

## 📦 Quick Start & Installation

### Option 1: Direct Git Integration (Recommended)

1. In your Looker instance, navigate to **Develop > Projects** and create a new project (e.g., `agent_optimizer`).
2. Configure Git with this repository URL.
3. The repository already includes `manifest.lkml`, `agent_optimizer.model.lkml`, and the compiled `bundle.js`.
4. Deploy the project to production. The extension will immediately appear in your Looker **Applications** menu.

### Option 2: Local Development

To develop or test locally:

```bash
# 1. Install dependencies
yarn install

# 2. Start local development server with Hot Module Reloading (HMR)
yarn develop
```

Then in your LookML `manifest.lkml`, temporarily switch the entrypoint:

```lookml
application: agent_optimizer {
  label: "Agent Feedback Optimizer"
  url: "http://localhost:8080/bundle.js"
  # file: "bundle.js"
  entitlements: { ... }
}
```

### Option 3: Compiling Production Bundle

Whenever you make changes to `src/`:

```bash
yarn build
```

This compiles the React application into `dist/bundle.js` and automatically copies it to the root `bundle.js` for Looker LookML Git deployment.

---

## ⚙️ BigQuery ML Remote Model Setup

To enable the autonomous optimization engine on your BigQuery connection, create a Vertex AI remote model in BigQuery using standard SQL:

```sql
-- 1. Create Cloud Resource connection in BigQuery (or use an existing connection)
-- Console: BigQuery > + ADD > External data source > Vertex AI remote models

-- 2. Create the remote model in your dataset
CREATE OR REPLACE MODEL `your_gcp_project.your_dataset.gemini_model`
REMOTE WITH CONNECTION `us.your_connection_id`
OPTIONS (ENDPOINT = 'gemini-2.5-flash');
```

In the extension's **Recommendation Agent** tab, click **⚙️ Connection Settings** to select your Looker BigQuery connection and input your model identifier (`your_gcp_project.your_dataset.gemini_model`).

> **Note**: If your BigQuery remote model is still being provisioned, the extension provides a built-in **"Preview Sample Report"** fallback so you can explore all recommendation and prompt diff features immediately.

---

## 📋 LookML Manifest Entitlements

The `manifest.lkml` includes all required Looker Core API methods:

```lookml
project_name: "agent_optimizer"

application: agent_optimizer {
  label: "Agent Feedback Optimizer"
  file: "bundle.js"
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
      "all_conversation_messages",
      "create_sql_query",
      "run_sql_query",
      "all_connections"
    ]
    use_embeds: yes
    use_form_submit: yes
    use_clipboard: yes
    local_storage: yes
    navigation: yes
    new_window: yes
  }
}
```

---

## 📂 Repository Structure

```
looker-agent-optimizer-extension/
├── manifest.lkml                 # Looker Extension application declaration & entitlements
├── agent_optimizer.model.lkml    # Minimal LookML model for database connection routing
├── package.json                  # Dependencies and build scripts
├── webpack.config.js             # Webpack 5 bundling and dev server config
├── bundle.js                     # Root production bundle for LookML Git deployment
├── dist/                         # Webpack distribution output
└── src/
    ├── index.jsx                 # Application entrypoint & ExtensionProvider40 wrapper
    ├── App.jsx                   # Main application with 6 tabs & dark mode
    └── services/
        ├── agentService.js       # Looker Core API service (agents, chat, telemetry)
        └── bqmlOptimizerService.js # In-database BigQuery ML inference service
```

