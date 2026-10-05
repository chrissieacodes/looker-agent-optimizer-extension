/**
 * Agent Service
 * Handles Looker Core 4.0 API interactions for Agents, Conversations, Chat, and Telemetry.
 */

export const MOCK_AGENTS = [
  {
    id: 'fake_zenith',
    name: 'Zenith Sales Forecasting',
    description: 'Predicts sales trends and identifies high-value opportunities using historic pipeline data.',
    context: {
      instructions: 'Focus on predicting sales trends for next quarter. Filter out internal test orders. Group by region and product line.'
    },
    sources: [
      { model: 'sales', explore: 'orders' },
      { model: 'sales', explore: 'targets' },
      { model: 'marketing', explore: 'campaigns' }
    ],
    code_interpreter: true,
    golden_query_ids: [1, 2]
  },
  {
    id: 'fake_vanguard',
    name: 'Vanguard Risk Assessor',
    description: 'Audits financial transactions and identifies potential compliance violations or anomalies.',
    context: {
      instructions: 'Scan transactions for anomalies exceeding $10k. Cross-reference with user IP history.'
    },
    sources: [
      { model: 'finance', explore: 'transactions' },
      { model: 'security', explore: 'audit_logs' }
    ],
    code_interpreter: false,
    golden_query_ids: []
  },
  {
    id: 'fake_titan',
    name: 'Titan Inventory Manager',
    description: 'Optimizes supply chain and inventory levels across multiple fulfillment centers.',
    context: {
      instructions: 'Monitor safety stock levels. Flag items below 10% safety margin immediately.'
    },
    sources: [
      { model: 'supply_chain', explore: 'inventory' },
      { model: 'logistics', explore: 'shipping' }
    ],
    code_interpreter: true,
    golden_query_ids: [10]
  }
];

export async function fetchAgents(coreSDK) {
  try {
    let agents = [];
    if (coreSDK.search_agents) {
      agents = await coreSDK.ok(coreSDK.search_agents({ limit: 100 }));
    } else {
      agents = await coreSDK.ok(coreSDK.get('/agents/search', { limit: 100 }));
    }

    if (Array.isArray(agents) && agents.length > 0) {
      return [...agents, ...MOCK_AGENTS];
    }
  } catch (err) {
    console.warn('Could not fetch agents via Core API, using mock agents:', err);
  }
  return MOCK_AGENTS;
}

export async function getAgentDetails(coreSDK, agentId) {
  if (agentId.startsWith('fake_')) {
    return MOCK_AGENTS.find(a => a.id === agentId);
  }

  try {
    if (coreSDK.get_agent) {
      return await coreSDK.ok(coreSDK.get_agent(agentId));
    } else {
      return await coreSDK.ok(coreSDK.get(`/agents/${agentId}`));
    }
  } catch (err) {
    console.error(`Error fetching agent ${agentId}:`, err);
    throw err;
  }
}

export async function updateAgentConfig(coreSDK, agentId, updatePayload) {
  if (agentId.startsWith('fake_')) {
    // Local simulation update
    const mock = MOCK_AGENTS.find(a => a.id === agentId);
    if (mock) {
      Object.assign(mock, updatePayload);
      if (updatePayload.instructions) {
        mock.context = mock.context || {};
        mock.context.instructions = updatePayload.instructions;
      }
    }
    return { ok: true, simulated: true };
  }

  const body = {
    name: updatePayload.name,
    description: updatePayload.description,
    code_interpreter: updatePayload.code_interpreter,
    context: {
      instructions: updatePayload.instructions
    },
    sources: updatePayload.sources || []
  };

  try {
    if (coreSDK.update_agent) {
      return await coreSDK.ok(coreSDK.update_agent(agentId, body));
    } else {
      return await coreSDK.ok(coreSDK.patch(`/agents/${agentId}`, null, body));
    }
  } catch (err) {
    console.error(`Error updating agent ${agentId}:`, err);
    throw err;
  }
}

export async function createConversation(coreSDK, agentId, name = null) {
  if (agentId && agentId.startsWith("fake_")) {
    return { id: `fake_conv_${Date.now()}` };
  }

  const convName = name || `Preview Chat - ${agentId}`;

  try {
    if (coreSDK.create_conversation) {
      return await coreSDK.ok(coreSDK.create_conversation({
        name: convName,
        agent_id: agentId
      }));
    } else {
      return await coreSDK.ok(coreSDK.post("/conversations", null, {
        name: convName,
        agent_id: agentId
      }));
    }
  } catch (err) {
    console.error(`Error creating conversation for agent ${agentId}:`, err);
    throw err;
  }
}

export async function sendChatMessage(coreSDK, conversationId, userMessage, agentName = 'Agent') {
  if (conversationId && conversationId.startsWith('fake_')) {
    await new Promise(r => setTimeout(r, 600));
    return [
      {
        role: 'agent',
        text: `[Simulation] Response from ${agentName}: I received your query "${userMessage}".`
      }
    ];
  }

  try {
    let result;
    if (coreSDK.conversational_analytics_chat) {
      result = await coreSDK.ok(coreSDK.conversational_analytics_chat({
        conversation_id: conversationId,
        user_message: userMessage
      }));
    } else {
      result = await coreSDK.ok(coreSDK.post('/conversational_analytics/chat', null, {
        conversation_id: conversationId,
        user_message: userMessage
      }));
    }

    // Parse messages
    if (Array.isArray(result)) {
      return result.map(m => ({
        role: m.role || 'agent',
        text: m.content || m.message || JSON.stringify(m)
      }));
    }
    return [{ role: 'agent', text: result.content || result.message || 'No response content.' }];
  } catch (err) {
    console.error('Error during conversational_analytics_chat:', err);
    return [{ role: 'agent', text: `Error: ${err.message || 'Failed to chat with agent'}` }];
  }
}

export async function runTelemetryQuery(coreSDK, agentId = null) {
  const filters = {};
  if (agentId && agentId !== "All" && !agentId.startsWith("fake_")) {
    // In system__activity, agent.id is a number dimension, while agent.guid is a string dimension
    if (/^\d+$/.test(String(agentId))) {
      filters["agent.id"] = String(agentId);
    } else {
      filters["agent.guid"] = String(agentId);
    }
  }

  try {
    const rows = await coreSDK.ok(coreSDK.run_inline_query({
      result_format: 'json',
      body: {
        model: 'system__activity',
        view: 'conversations_feedback',
        fields: [
          'conversation.id',
          'agent.name',
          'agent.formatted_name',
          'agent.guid',
          'agent.id',
          'conversation_sa_telemetry.timestamp',
          'conversation_sa_telemetry.user_message_truncated',
          'conversation_sa_telemetry.answer_success',
          'conversation_sa_telemetry.health',
          'conversation_sa_telemetry.rating',
          'conversation_sa_telemetry.latency',
          'conversation.category'
        ],
        filters: filters,
        sorts: ['conversation_sa_telemetry.timestamp desc'],
        limit: 50
      }
    }));
    return rows;
  } catch (err) {
    console.warn('Telemetry query failed, falling back to mock rows:', err);
    return [
      {
        'conversation.id': 1001,
        'agent.name': 'Zenith Sales Forecasting',
        'agent.formatted_name': 'Zenith Sales Forecasting',
        'agent.guid': 'fake_zenith',
        'agent.id': 1,
        'conversation_sa_telemetry.timestamp': '2026-10-03 04:00',
        'conversation_sa_telemetry.user_message_truncated': 'What are the predicted sales for next month?',
        'conversation_sa_telemetry.answer_success': 'Yes',
        'conversation_sa_telemetry.health': 'Healthy',
        'conversation_sa_telemetry.rating': 'THUMBS_UP',
        'conversation_sa_telemetry.latency': 850,
        'conversation.category': 'Forecasting'
      },
      {
        'conversation.id': 1002,
        'agent.name': 'Vanguard Risk Assessor',
        'agent.formatted_name': 'Vanguard Risk Assessor',
        'agent.guid': 'fake_vanguard',
        'agent.id': 2,
        'conversation_sa_telemetry.timestamp': '2026-10-03 02:15',
        'conversation_sa_telemetry.user_message_truncated': 'List transactions over $50k this quarter',
        'conversation_sa_telemetry.answer_success': 'Yes',
        'conversation_sa_telemetry.health': 'Healthy',
        'conversation_sa_telemetry.rating': 'THUMBS_UP',
        'conversation_sa_telemetry.latency': 1120,
        'conversation.category': 'Audit'
      },
      {
        'conversation.id': 1003,
        'agent.name': 'Titan Inventory Manager',
        'agent.formatted_name': 'Titan Inventory Manager',
        'agent.guid': 'fake_titan',
        'agent.id': 3,
        'conversation_sa_telemetry.timestamp': '2026-10-02 21:40',
        'conversation_sa_telemetry.user_message_truncated': 'Why did inventory replenishment fail?',
        'conversation_sa_telemetry.answer_success': 'No',
        'conversation_sa_telemetry.health': 'Degraded',
        'conversation_sa_telemetry.rating': 'THUMBS_DOWN',
        'conversation_sa_telemetry.latency': 2700,
        'conversation.category': 'Logistics'
      }
    ];
  }
}

export async function requestAgentOptimization(agentConfig, telemetryRows, userAuthToken = null, extensionSDK = null) {
  if (!extensionSDK || typeof extensionSDK.fetchProxy !== "function") {
    throw new Error("Looker Extension SDK fetchProxy is not available.");
  }

  const token = userAuthToken ? userAuthToken.trim() : "";
  const headers = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const payload = {
    agent: agentConfig,
    telemetry: telemetryRows
  };

  const endpoints = [
    "https://agent-optimizer-backend-82452831399.us-central1.run.app/api/optimize-agent",
    "https://agent-optimizer-backend-ofamr32cra-uc.a.run.app/api/optimize-agent"
  ];

  let lastError = null;

  for (const url of endpoints) {
    try {
      console.info(`[AgentOptimizer] Calling Cloud Run via extensionSDK.fetchProxy: ${url}...`);
      const response = await extensionSDK.fetchProxy(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      if (response && response.ok && response.body) {
        const data = typeof response.body === "string" ? JSON.parse(response.body) : response.body;
        data.source = "Vertex AI (Gemini 2.5 Flash on Cloud Run via fetchProxy)";
        return data;
      }

      if (response && !response.ok) {
        const errDetail = typeof response.body === "string" ? response.body : JSON.stringify(response.body || response.statusText || "");
        console.warn(`[AgentOptimizer] fetchProxy to ${url} returned HTTP ${response.status}: ${errDetail}`);
        lastError = new Error(`Cloud Run returned HTTP ${response.status}: ${errDetail}`);
      }
    } catch (err) {
      console.warn(`[AgentOptimizer] fetchProxy to ${url} failed:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to reach Cloud Run Vertex AI Optimizer backend via fetchProxy.");
}

export const optimizeAgent = requestAgentOptimization;
