/**
 * BigQuery ML (BQML) Optimizer Service
 * 
 * Implements the Looker Explore Assistant BQML architectural pattern:
 * - Leverages BigQuery's `ML.GENERATE_TEXT` with Vertex AI Remote Models.
 * - Executes directly via Looker Core API (`create_sql_query` & `run_sql_query`).
 * - Completely avoids Cloud Run, CORS, external API URLs, and IAP 302 redirects.
 */

// Default configuration constants (can be overridden via environment, user attributes, or UI)
export const DEFAULT_BQ_CONNECTION = 'bigquery';
export const DEFAULT_BQ_MODEL_ID = 'cloud-looker-devrel-demos.agent_optimizer_us.gemini_model';

/**
 * Escapes characters for BigQuery SQL string literals.
 * Handles single quotes, backslashes, and line breaks.
 */
export function escapeBigQueryString(str) {
  if (typeof str !== 'string') {
    str = JSON.stringify(str || '');
  }
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}

/**
 * Generates the structured prompt sent to Gemini via BigQuery ML.
 */
export function buildAgentOptimizerPrompt(agentConfig, telemetryRows) {
  return `You are an expert Looker Conversational Analytics & AI Agent Optimization Specialist.
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

RESPOND STRICTLY WITH VALID JSON matching this exact structure:
{
  "status": "NEEDS_OPTIMIZATION",
  "summary": "Executive summary of the evaluation (1-2 sentences).",
  "performanceScore": 85,
  "themes": [
    { "label": "Short Theme Name", "type": "negative", "details": "Explanation..." }
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
}

/**
 * Constructs the BigQuery ML.GENERATE_TEXT SQL query.
 * Following the Looker Explore Assistant BigQueryHelper pattern.
 */
export function generateBqmlSQL(modelId, prompt, parameters = {}) {
  const {
    temperature = 0.2,
    max_output_tokens = 2048,
    top_p = 0.95,
    top_k = 40,
    flatten_json_output = true
  } = parameters;

  const escapedPrompt = escapeBigQueryString(prompt);

  return `
SELECT ml_generate_text_llm_result AS generated_content
FROM
  ML.GENERATE_TEXT(
    MODEL \`${modelId}\`,
    (
      SELECT '${escapedPrompt}' AS prompt
    ),
    STRUCT(
      ${temperature} AS temperature,
      ${max_output_tokens} AS max_output_tokens,
      ${top_p} AS top_p,
      ${top_k} AS top_k,
      ${flatten_json_output} AS flatten_json_output
    )
  )
`.trim();
}

/**
 * Cleans markdown formatting and parses JSON returned by Gemini.
 */
export function parseBqmlResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty response received from BigQuery ML.');
  }

  let cleaned = rawText.trim();
  // Strip Markdown code fencing if present
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```JSON')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }

  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Sometimes the model might return text before or after the JSON block
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

/**
 * Discovers available BigQuery connections in Looker.
 */
export async function getBigQueryConnections(coreSDK) {
  try {
    if (!coreSDK || !coreSDK.all_connections) {
      return [];
    }
    const connections = await coreSDK.ok(coreSDK.all_connections({ fields: 'name,dialect_name' }));
    return (connections || []).filter(c => 
      c.dialect_name && (c.dialect_name.toLowerCase().includes('bigquery') || c.dialect_name.toLowerCase().includes('google_bigquery'))
    );
  } catch (err) {
    console.warn('[BQML Optimizer] Failed to list Looker connections:', err);
    return [];
  }
}

/**
 * Executes agent optimization via BigQuery ML using Looker Core API.
 * 
 * @param {Object} params
 * @param {Object} params.coreSDK - Looker Core 4.0 SDK instance (from ExtensionContext)
 * @param {Object} params.agentConfig - Agent configuration object (name, instructions, explores, etc.)
 * @param {Array} params.telemetryRows - Feedback & telemetry message rows
 * @param {string} [params.connectionName] - Looker connection name pointing to BigQuery (default: 'bigquery')
 * @param {string} [params.modelId] - BigQuery remote model identifier (e.g. 'my_project.my_dataset.gemini_model')
 * @param {Object} [params.modelParams] - Optional parameters for ML.GENERATE_TEXT
 * @returns {Promise<Object>} Structured optimization report
 */
export async function requestBqmlAgentOptimization({
  coreSDK,
  agentConfig,
  telemetryRows,
  connectionName = DEFAULT_BQ_CONNECTION,
  modelId = DEFAULT_BQ_MODEL_ID,
  modelParams = {}
}) {
  if (!coreSDK) {
    throw new Error('Looker coreSDK is required to execute BigQuery ML queries.');
  }

  console.info(`[BQML Optimizer] Preparing optimization via connection "${connectionName}" and model "${modelId}"...`);

  const prompt = buildAgentOptimizerPrompt(agentConfig, telemetryRows);
  const sql = generateBqmlSQL(modelId, prompt, modelParams);

  // 1. Create SQL Query in Looker
  let querySlug;
  try {
    const createQueryResponse = await coreSDK.ok(
      coreSDK.create_sql_query({
        connection_name: connectionName,
        sql
      })
    );
    querySlug = createQueryResponse.slug;
  } catch (err) {
    console.error('[BQML Optimizer] Failed to create SQL query via Looker Core API:', err);
    throw new Error(`Looker create_sql_query failed on connection "${connectionName}": ${err.message || err}`);
  }

  if (!querySlug) {
    throw new Error('Looker create_sql_query did not return a valid query slug.');
  }

  // 2. Execute SQL Query
  let rows;
  try {
    rows = await coreSDK.ok(
      coreSDK.run_sql_query(querySlug, 'json')
    );
  } catch (err) {
    console.error(`[BQML Optimizer] Failed to execute SQL query (${querySlug}):`, err);
    throw new Error(`Looker run_sql_query failed: ${err.message || err}`);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('BigQuery ML returned an empty result set.');
  }

  // 3. Extract generated text from result row
  const firstRow = rows[0];
  const rawGeneratedText = firstRow.generated_content || 
                           firstRow.ml_generate_text_llm_result || 
                           firstRow[Object.keys(firstRow)[0]];

  if (!rawGeneratedText) {
    throw new Error(`BigQuery ML result row did not contain generated content: ${JSON.stringify(firstRow)}`);
  }

  // 4. Parse JSON
  const report = parseBqmlResponse(rawGeneratedText);
  report.source = `BigQuery ML (ML.GENERATE_TEXT on ${modelId} via connection "${connectionName}")`;
  report.connectionName = connectionName;
  report.modelId = modelId;

  return report;
}
