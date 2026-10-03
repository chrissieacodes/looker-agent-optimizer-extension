const express = require('express');
const path = require('path');
const { callGeminiOptimizer } = require('./src/services/vertexOptimizer');

const app = express();
const PORT = process.env.PORT || 8080;

// Enable CORS for Looker extension iframes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Autonomous AI Optimization endpoint (Vertex AI Gemini 2.5 Flash)
app.post('/api/optimize-agent', async (req, res) => {
  try {
    const { agent, telemetry } = req.body || {};
    const result = await callGeminiOptimizer(agent || {}, telemetry || []);
    res.json(result);
  } catch (err) {
    console.error('Optimizer API error:', err);
    res.status(500).json({ error: err.message || 'Failed to run optimization' });
  }
});

// Serve compiled static assets (bundle.js, index.html)
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Agent Optimizer server listening on port ${PORT}`);
});
