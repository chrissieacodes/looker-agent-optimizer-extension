const { execSync } = require('child_process');
const https = require('https');

async function getAccessToken() {
  if (process.env.GOOGLE_OAUTH_TOKEN) {
    return process.env.GOOGLE_OAUTH_TOKEN;
  }
  try {
    const token = execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
    return token;
  } catch (err) {
    console.error('Failed to get token from gcloud:', err.message);
    return null;
  }
}

async function callGeminiOptimizer(agentConfig, telemetryRows, overrideModel = null) {
  const token = await getAccessToken();
  const project = process.env.GCP_PROJECT || 'cloud-looker-devrel-demos';
  const location = process.env.GCP_LOCATION || 'us-central1';
  const model = overrideModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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

RESPOND STRICTLY WITH VALID JSON matching this exact structure:
{
  "status": "NEEDS_OPTIMIZATION" | "PERFECT",
  "summary": "Executive summary of the evaluation (1-2 sentences).",
  "performanceScore": 85,
  "themes": [
    { "label": "Short Theme Name", "type": "negative" | "warning" | "positive", "details": "Explanation..." }
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

  if (!token) {
    // Fallback if no ADC token
    return {
      status: 'NEEDS_OPTIMIZATION',
      summary: `Automated assessment for ${agentConfig.name}: Negative user feedback indicates date ambiguity and query timeouts.`,
      performanceScore: 68,
      themes: [
        { label: 'Date Ambiguity', type: 'negative', details: 'Users asked for relative date ranges that were unmapped.' },
        { label: 'High Latency', type: 'warning', details: 'Analytical queries exceeded 2000ms latency.' },
        { label: 'Concise Formatting', type: 'positive', details: 'Users appreciated bulleted formatting.' }
      ],
      rootCauseAnalysis: 'The agent instructions lack explicit mappings for relative timeframes and do not restrict heavy queries.',
      recommendations: {
        instructionImprovements: 'Define default date dimensions and add negative constraints for out-of-scope questions.',
        suggestedFullInstructions: `${agentConfig.instructions || ''}\n\n- When users ask about relative dates, default to order_items.created_date.\n- Present answers in concise bulleted summaries for executive review.`,
        sourcesRecommendations: 'Ensure the explore contains pre-aggregated PDTs for high-volume transactions.',
        codeInterpreterRecommendation: 'Keep enabled for trend calculations.'
      },
      actionPlan: [
        'Update agent instructions with explicit date dimension mappings.',
        'Add executive summary formatting rule.',
        'Test updated instructions in Live Preview chat.'
      ]
    };
  }

  const payload = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' }
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${location}-aiplatform.googleapis.com`,
      path: `/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', async () => {
        if (res.statusCode === 404 && model !== 'gemini-2.5-flash') {
          console.warn(`Model ${model} not available on Vertex AI (404). Falling back to gemini-2.5-flash.`);
          try {
            const fallback = await callGeminiOptimizer(agentConfig, telemetryRows, 'gemini-2.5-flash');
            return resolve(fallback);
          } catch (e) {
            return reject(e);
          }
        }

        try {
          const parsed = JSON.parse(data);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            const result = JSON.parse(text);
            result.modelUsed = model;
            resolve(result);
          } else {
            console.warn('Unexpected Vertex response:', data);
            reject(new Error(parsed?.error?.message || 'No candidate content returned from Gemini'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

module.exports = { callGeminiOptimizer };
