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

function extractJsonFromText(rawText) {
  if (!rawText || typeof rawText !== "string") return null;

  let cleaned = rawText.trim();
  // Strip markdown code fences if present (e.g. ```json ... ``` or ``` ...)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = cleaned.match(codeBlockRegex);
  if (match && match[1]) {
    cleaned = match[1].trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const firstIdx = cleaned.indexOf("{");
    const lastIdx = cleaned.lastIndexOf("}");
    if (firstIdx !== -1 && lastIdx > firstIdx) {
      const candidate = cleaned.substring(firstIdx, lastIdx + 1);
      return JSON.parse(candidate);
    }
    throw new Error(`Unable to parse AI response as valid JSON: ${rawText.slice(0, 300)}...`);
  }
}

function generateSimulationOptimization(agentConfig, telemetryRows) {
  const agentName = agentConfig?.name || "Selected Agent";
  const currentInstructions = agentConfig?.instructions || "";

  return {
    status: "NEEDS_OPTIMIZATION",
    summary: `Autonomous evaluation for ${agentName}: Telemetry reveals user inquiries regarding date ranges and performance latency require prompt guardrails.`,
    performanceScore: 78,
    themes: [
      { label: "Relative Date Ambiguity", type: "negative", details: "Users asked questions with relative terms like 'last month' that lacked explicit dimension mappings." },
      { label: "Analytical Query Latency", type: "warning", details: "Aggregate calculation queries experienced higher latency." },
      { label: "Formatting Consistency", type: "positive", details: "Users consistently rated structured responses positively." }
    ],
    rootCauseAnalysis: "The agent's current instructions do not explicitly instruct the model on default date dimensions or query limits. Adding targeted rules prevents ambiguity.",
    recommendations: {
      instructionImprovements: "Explicitly designate primary date dimensions, specify sorting defaults, and enforce bulleted summaries.",
      suggestedFullInstructions: `${currentInstructions}\n\n- When users ask about relative dates, default to created_date.\n- Present answers in concise bulleted summaries for executive review.`,
      sourcesRecommendations: "Ensure the explore contains pre-aggregated PDTs for high-volume transactions.",
      codeInterpreterRecommendation: "Keep code interpreter enabled for trend calculations and forecasting."
    },
    actionPlan: [
      "Apply suggested instructions with explicit date dimension mappings.",
      "Verify query performance with pre-aggregated PDTs.",
      "Test updated instructions in Live Preview chat."
    ],
    source: "Looker Conversational Analytics Agent (Simulation)"
  };
}

export async function requestAgentOptimization(agentConfig, telemetryRows, userAuthToken = null, extensionSDK = null, coreSDK = null) {
  // Resolve coreSDK from parameters
  let sdk = coreSDK;
  if (!sdk && userAuthToken && typeof userAuthToken === "object" && (userAuthToken.ok || userAuthToken.search_agents || userAuthToken.create_conversation)) {
    sdk = userAuthToken;
  }
  if (!sdk && extensionSDK && typeof extensionSDK === "object" && (extensionSDK.ok || extensionSDK.search_agents || extensionSDK.create_conversation)) {
    sdk = extensionSDK;
  }

  // Standalone / Mock mode handling
  if (!sdk || (agentConfig?.id && String(agentConfig.id).startsWith("fake_"))) {
    console.info("[AgentOptimizer] Standalone/mock agent detected. Generating simulation analysis.");
    await new Promise(r => setTimeout(r, 600));
    return generateSimulationOptimization(agentConfig, telemetryRows);
  }

  const prompt = `You are an expert Looker Conversational Analytics & AI Agent Optimization Specialist.
Your task is to analyze the performance, user feedback, and system activity telemetry of a Looker AI Agent and compare it with the agent's current configuration, system instructions, and linked LookML explores.

AGENT CONFIGURATION:
${JSON.stringify(agentConfig, null, 2)}

TELEMETRY & USER FEEDBACK:
${JSON.stringify(telemetryRows, null, 2)}

EVALUATION GUIDELINES:
1. Examine negative ratings (THUMBS_DOWN), answer failures, degraded health, or high latency.
2. Determine if queries failed due to ambiguous date terms, undefined business metrics, or missing LookML explores.
3. Compare what users actually asked vs what the agent was instructed to handle.
4. If feedback is overwhelmingly positive (all THUMBS_UP, low latency, 100% success), set status to "PERFECT" and state no changes are needed.
5. Otherwise, set status to "NEEDS_OPTIMIZATION" and provide specific, high-impact instruction prompt rewrites and explore suggestions.

CRITICAL FORMATTING INSTRUCTION:
You MUST reply ONLY with a raw JSON object (enclosed in { and }). Do not include markdown ticks, no preamble, and no explanation text outside the JSON.

Expected JSON schema:
{
  "status": "NEEDS_OPTIMIZATION",
  "summary": "Executive summary of the evaluation (1-2 sentences).",
  "performanceScore": 82,
  "themes": [
    { "label": "Short Theme Name", "type": "negative", "details": "Detailed explanation..." }
  ],
  "rootCauseAnalysis": "Detailed analysis comparing feedback to agent instructions...",
  "recommendations": {
    "instructionImprovements": "Key additions or rules to add to the prompt...",
    "suggestedFullInstructions": "Complete ready-to-use proposed text for the instructions field...",
    "sourcesRecommendations": "Specific suggestions for linked LookML explores/models...",
    "codeInterpreterRecommendation": "Whether code interpreter should be enabled/disabled and why."
  },
  "actionPlan": [
    "Step 1...",
    "Step 2..."
  ]
}`;

  console.info("[AgentOptimizer] Invoking Looker Native Conversational Analytics Agent for AI optimization...");

  try {
    let targetAgentId = agentConfig.id;

    // Search for a dedicated optimizer meta-agent if available
    try {
      if (typeof sdk.search_agents === "function") {
        const existingAgents = await sdk.ok(sdk.search_agents({ limit: 50 }));
        const metaAgent = existingAgents.find(a => 
          a.name && (a.name.toLowerCase().includes("optimizer") || a.name.toLowerCase().includes("specialist"))
        );
        if (metaAgent) {
          targetAgentId = metaAgent.id;
          console.info(`[AgentOptimizer] Using dedicated meta-agent: ${metaAgent.name} (id: ${metaAgent.id})`);
        }
      }
    } catch (e) {
      console.warn("[AgentOptimizer] Agent search fallback, using selected agent:", e);
    }

    // 1. Create conversation session
    console.info(`[AgentOptimizer] Creating analysis conversation for agent ${targetAgentId}...`);
    const conv = await createConversation(sdk, targetAgentId, `AI Optimization Analysis - ${agentConfig.name}`);
    const conversationId = conv.id;

    // 2. Send chat message with the optimization prompt
    console.info(`[AgentOptimizer] Sending optimization prompt to conversation ${conversationId}...`);
    const chatResponses = await sendChatMessage(sdk, conversationId, prompt, agentConfig.name);

    // 3. Extract and parse the response JSON
    const agentReply = Array.isArray(chatResponses) 
      ? chatResponses.map(m => m.text).join("\n") 
      : (chatResponses?.text || JSON.stringify(chatResponses));

    console.info("[AgentOptimizer] Received conversational analytics response:", agentReply);

    const parsedReport = extractJsonFromText(agentReply);
    if (!parsedReport || !parsedReport.status) {
      throw new Error(`Invalid JSON format returned from Looker Conversational Agent: ${agentReply.slice(0, 150)}...`);
    }

    parsedReport.source = "Looker Conversational Analytics Agent (Native Gemini API)";
    return parsedReport;
  } catch (err) {
    console.error("[AgentOptimizer] Native Conversational Agent optimization failed:", err);
    throw new Error(`Looker Conversational Analytics Agent error: ${err.message || err}`);
  }
}

export const optimizeAgent = requestAgentOptimization;
