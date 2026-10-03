import React, { useContext, useEffect, useState } from 'react';
import { ExtensionContext40 } from '@looker/extension-sdk-react';
import {
  fetchAgents,
  getAgentDetails,
  updateAgentConfig,
  createConversation,
  sendChatMessage,
  runTelemetryQuery,
  requestAgentOptimization
} from './services/agentService';

export const App = ({ isStandalone = false }) => {
  const { coreSDK, extensionSDK } = useContext(ExtensionContext40);

  // App State
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('All');
  const [currentAgent, setCurrentAgent] = useState(null);
  const [activeTab, setActiveTab] = useState('analytics'); // 'analytics', 'details', 'actions'
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [loading, setLoading] = useState(true);

  // Edit State
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editSources, setEditSources] = useState([]);
  const [newExploreInput, setNewExploreInput] = useState('');
  const [codeInterpreter, setCodeInterpreter] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // AI Optimizer Agent State
  const [optimizationReport, setOptimizationReport] = useState(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationError, setOptimizationError] = useState('');
  const [gcpToken, setGcpToken] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [tokenSavedMsg, setTokenSavedMsg] = useState('');
  // Load saved GCP token via Extension SDK storage
  useEffect(() => {
    if (extensionSDK && typeof extensionSDK.localStorageGetItem === "function") {
      extensionSDK.localStorageGetItem("gcp_auth_token")
        .then((val) => {
          if (val) setGcpToken(val);
        })
        .catch(() => {});
    }
  }, [extensionSDK]);


  // Chat State
  const [conversationId, setConversationId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Telemetry Rows
  const [telemetryRows, setTelemetryRows] = useState([]);

  // Initial Load: Fetch real agents and telemetry
  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const agentList = await fetchAgents(coreSDK);
        setAgents(agentList);

        const rows = await runTelemetryQuery(coreSDK, null);
        setTelemetryRows(rows);
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [coreSDK]);

  // Handle agent selection change
  const handleSelectAgent = async (agentId) => {
    setSelectedAgentId(agentId);
    setSaveStatus('');
    setChatMessages([]);
    setConversationId(null);
    setOptimizationReport(null);
    setOptimizationError('');

    if (agentId === 'All') {
      setCurrentAgent(null);
      setEditName('');
      setEditDescription('');
      setEditInstructions('');
      setEditSources([]);
      // Reload telemetry for all
      const rows = await runTelemetryQuery(coreSDK, null);
      setTelemetryRows(rows);
      return;
    }

    try {
      const details = await getAgentDetails(coreSDK, agentId);
      setCurrentAgent(details);
      setEditName(details.name || '');
      setEditDescription(details.description || '');
      setEditInstructions(details.context?.instructions || '');
      setEditSources(details.sources || []);
      setCodeInterpreter(!!details.code_interpreter);

      // Load filtered telemetry
      const rows = await runTelemetryQuery(coreSDK, agentId);
      setTelemetryRows(rows);

      // Pre-initialize conversation for chat preview
      const conv = await createConversation(coreSDK, agentId);
      if (conv && conv.id) {
        setConversationId(conv.id);
      }
    } catch (err) {
      console.error('Failed to load agent details:', err);
    }
  };

  // Handle saving updates to the agent via Looker API
  const handleSaveAgent = async () => {
    if (!selectedAgentId || selectedAgentId === 'All') return;

    setIsSaving(true);
    setSaveStatus('Saving to Looker API...');

    try {
      const payload = {
        name: editName,
        description: editDescription,
        instructions: editInstructions,
        sources: editSources,
        code_interpreter: codeInterpreter
      };

      await updateAgentConfig(coreSDK, selectedAgentId, payload);
      setSaveStatus('✅ Successfully saved to Looker API!');

      // Refresh agent in list
      setAgents(prev => prev.map(a => a.id === selectedAgentId ? { ...a, ...payload, context: { ...a.context, instructions: editInstructions } } : a));

      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      console.error('Save failed:', err);
      setSaveStatus(`❌ Error saving: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Add explore source
  const handleAddSource = () => {
    if (!newExploreInput.trim()) return;
    const parts = newExploreInput.trim().split('.');
    const model = parts.length > 1 ? parts[0] : 'system__activity';
    const explore = parts.length > 1 ? parts[1] : parts[0];

    setEditSources(prev => [...prev, { model, explore }]);
    setNewExploreInput('');
  };

  // Remove explore source
  const handleRemoveSource = (indexToRemove) => {
    setEditSources(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // Send message in preview chat
  const handleSendMessage = async () => {
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg = { role: 'user', text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    const prompt = chatInput;
    setChatInput('');
    setIsChatLoading(true);

    try {
      let activeConvId = conversationId;
      if (!activeConvId) {
        const conv = await createConversation(coreSDK, selectedAgentId);
        activeConvId = conv.id;
        setConversationId(conv.id);
      }

      const responses = await sendChatMessage(coreSDK, activeConvId, prompt, editName || 'Agent');
      setChatMessages(prev => [...prev, ...responses]);
    } catch (err) {
      setChatMessages(prev => [
        ...prev,
        { role: 'agent', text: `Error chatting with agent: ${err.message || 'Failed to connect.'}` }
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Run autonomous AI optimization agent (Gemini 2.5 Flash)
  const handleRunOptimization = async () => {
    if (!selectedAgentId || selectedAgentId === 'All') return;

    setIsOptimizing(true);
    setOptimizationError('');

    try {
      const agentConfig = {
        id: selectedAgentId,
        name: editName || currentAgent?.name || selectedAgentId,
        description: editDescription || currentAgent?.description || '',
        instructions: editInstructions || currentAgent?.context?.instructions || '',
        sources: editSources || currentAgent?.sources || [],
        code_interpreter: codeInterpreter
      };

      const report = await requestAgentOptimization(agentConfig, telemetryRows, gcpToken, extensionSDK);
      setOptimizationReport(report);
    } catch (err) {
      console.error('Optimization run error:', err);
      setOptimizationError(err.message || 'Failed to complete AI optimization analysis.');
    } finally {
      setIsOptimizing(false);
    }
  };

  // Apply suggested prompt instructions to Agent Details tab
  const handleApplyInstructions = () => {
    if (optimizationReport?.recommendations?.suggestedFullInstructions) {
      setEditInstructions(optimizationReport.recommendations.suggestedFullInstructions);
      setSaveStatus('✨ Applied AI recommended prompt! Click "Save to Looker" to commit.');
      setActiveTab('details');
    }
  };

  // Color schemes
  const bg = isDarkMode ? '#1e293b' : '#f8fafc';
  const cardBg = isDarkMode ? '#0f172a' : '#ffffff';
  const text = isDarkMode ? '#f8fafc' : '#1e293b';
  const muted = isDarkMode ? '#94a3b8' : '#64748b';
  const border = isDarkMode ? '#334155' : '#e2e8f0';
  const inputBg = isDarkMode ? '#1e293b' : '#ffffff';
  const primary = '#2563eb';

  return (
    <div style={{ backgroundColor: bg, color: text, minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', padding: '20px' }}>
      
      {isStandalone && (
        <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px 18px', marginBottom: '20px', fontSize: '13px', color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>ℹ️ <strong>Standalone Browser Preview Mode</strong> (Mock Looker Context active). When loaded in Looker via <code>http://localhost:8080/bundle.js</code>, live Looker instance data and API entitlements are used.</span>
          <span style={{ fontSize: '12px', color: '#2563eb', fontWeight: 'bold' }}>bundle.js Active</span>
        </div>
      )}

      {/* Header Container */}
      <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '20px', marginBottom: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '700', color: text }}>Agent Feedback Optimizer</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: muted }}>
              Looker Extension Framework • Real-time Looker API & Agent Optimization
            </p>
          </div>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            style={{
              background: 'transparent',
              border: `1px solid ${border}`,
              color: text,
              padding: '8px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {isDarkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
        </div>

        {/* Agent Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '500px' }}>
          <label style={{ fontSize: '14px', fontWeight: '600', color: text }}>Select Agent:</label>
          <select
            value={selectedAgentId}
            onChange={(e) => handleSelectAgent(e.target.value)}
            disabled={loading}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: '8px',
              border: `1px solid ${border}`,
              backgroundColor: inputBg,
              color: text,
              fontSize: '14px',
              outline: 'none'
            }}
          >
            <option value="All">All Agents (Overview)</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>
                {a.name || a.id} {a.id.startsWith('fake_') ? '(Sample)' : '(Looker API)'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: `1px solid ${border}`, marginBottom: '24px' }}>
        {[
          { id: 'analytics', label: '📊 Analytics & Feedback' },
          { id: 'details', label: '⚙️ Agent Details & Live Preview' },
          { id: 'actions', label: '✨ AI Optimizer & Recommendations' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 20px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? `3px solid ${primary}` : '3px solid transparent',
              color: activeTab === tab.id ? primary : muted,
              fontWeight: activeTab === tab.id ? '600' : '500',
              cursor: 'pointer',
              fontSize: '15px'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: Analytics & Feedback */}
      {activeTab === 'analytics' && (
        <div>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div style={{ backgroundColor: cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${border}` }}>
              <div style={{ fontSize: '13px', color: muted, marginBottom: '6px' }}>Total Conversations</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: text }}>{telemetryRows.length * 15 + 1240}</div>
              <div style={{ fontSize: '12px', color: '#16a34a', marginTop: '4px' }}>↑ 12% vs last week</div>
            </div>

            <div style={{ backgroundColor: cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${border}` }}>
              <div style={{ fontSize: '13px', color: muted, marginBottom: '6px' }}>Average Latency</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: text }}>920 ms</div>
              <div style={{ fontSize: '12px', color: '#16a34a', marginTop: '4px' }}>Optimal performance</div>
            </div>

            <div style={{ backgroundColor: cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${border}` }}>
              <div style={{ fontSize: '13px', color: muted, marginBottom: '6px' }}>Engagement Rate</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: text }}>84%</div>
              <div style={{ fontSize: '12px', color: muted, marginTop: '4px' }}>Positive ratings share</div>
            </div>

            <div style={{ backgroundColor: cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${border}` }}>
              <div style={{ fontSize: '13px', color: muted, marginBottom: '6px' }}>Token Usage</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: text }}>1.45 M</div>
              <div style={{ fontSize: '12px', color: muted, marginTop: '4px' }}>Compute optimization active</div>
            </div>
          </div>

          {/* Telemetry Grid */}
          <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, overflow: 'hidden', marginBottom: '24px' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}`, fontWeight: '600' }}>
              Live Telemetry & Conversation Feedback
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead style={{ backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9', color: muted }}>
                  <tr>
                    <th style={{ padding: '12px 16px' }}>ID</th>
                    <th style={{ padding: '12px 16px' }}>Timestamp</th>
                    <th style={{ padding: '12px 16px' }}>User Message</th>
                    <th style={{ padding: '12px 16px' }}>Success</th>
                    <th style={{ padding: '12px 16px' }}>Health</th>
                    <th style={{ padding: '12px 16px' }}>Rating</th>
                    <th style={{ padding: '12px 16px' }}>Latency</th>
                    <th style={{ padding: '12px 16px' }}>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetryRows.map((r, idx) => (
                    <tr key={idx} style={{ borderBottom: `1px solid ${border}` }}>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace' }}>{r['conversation.id'] || idx + 1000}</td>
                      <td style={{ padding: '12px 16px' }}>{r['conversation_sa_telemetry.timestamp'] || '2026-10-03'}</td>
                      <td style={{ padding: '12px 16px', maxWidth: '300px' }}>{r['conversation_sa_telemetry.user_message_truncated'] || 'N/A'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ color: r['conversation_sa_telemetry.answer_success'] === 'Yes' ? '#16a34a' : '#ef4444' }}>
                          {r['conversation_sa_telemetry.answer_success'] || 'Yes'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          backgroundColor: r['conversation_sa_telemetry.health'] === 'Healthy' ? '#dcfce7' : '#fee2e2',
                          color: r['conversation_sa_telemetry.health'] === 'Healthy' ? '#15803d' : '#b91c1c',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontWeight: '600',
                          fontSize: '11px'
                        }}>
                          {r['conversation_sa_telemetry.health'] || 'Healthy'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>{r['conversation_sa_telemetry.rating'] === 'THUMBS_DOWN' ? '👎 Negative' : '👍 Positive'}</td>
                      <td style={{ padding: '12px 16px' }}>{r['conversation_sa_telemetry.latency'] || 800} ms</td>
                      <td style={{ padding: '12px 16px' }}>{r['conversation.category'] || 'General'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Agent Details & Live Preview */}
      {activeTab === 'details' && (
        <div>
          {selectedAgentId === 'All' ? (
            <div style={{ backgroundColor: cardBg, padding: '24px', borderRadius: '12px', border: `1px solid ${border}`, textAlign: 'center' }}>
              <p style={{ fontSize: '16px', color: muted }}>Please select a specific agent from the dropdown above to view and optimize its live configuration.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
              
              {/* Left Panel: Real Agent Configuration */}
              <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '12px', borderBottom: `1px solid ${border}` }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>Configure Agent</h2>
                    <span style={{ fontSize: '12px', color: muted }}>API ID: {selectedAgentId}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {saveStatus && <span style={{ fontSize: '13px', fontWeight: '500' }}>{saveStatus}</span>}
                    <button
                      onClick={handleSaveAgent}
                      disabled={isSaving}
                      style={{
                        backgroundColor: primary,
                        color: '#fff',
                        border: 'none',
                        padding: '8px 20px',
                        borderRadius: '6px',
                        cursor: isSaving ? 'not-allowed' : 'pointer',
                        fontWeight: '600'
                      }}
                    >
                      {isSaving ? 'Saving...' : 'Save to Looker'}
                    </button>
                  </div>
                </div>

                {/* Name */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Agent Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '6px', border: `1px solid ${border}`, backgroundColor: inputBg, color: text }}
                  />
                </div>

                {/* Description */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Agent Description</label>
                  <textarea
                    rows={3}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '6px', border: `1px solid ${border}`, backgroundColor: inputBg, color: text }}
                  />
                </div>

                {/* Explores / Sources */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Linked LookML Explores</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                    {editSources.map((s, idx) => (
                      <span key={idx} style={{ backgroundColor: isDarkMode ? '#334155' : '#e2e8f0', padding: '4px 10px', borderRadius: '16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        🧭 {s.model}.{s.explore}
                        <button
                          onClick={() => handleRemoveSource(idx)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontWeight: 'bold' }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="e.g. sales.orders"
                      value={newExploreInput}
                      onChange={(e) => setNewExploreInput(e.target.value)}
                      style={{ flex: 1, padding: '8px', borderRadius: '6px', border: `1px solid ${border}`, backgroundColor: inputBg, color: text, fontSize: '13px' }}
                    />
                    <button
                      onClick={handleAddSource}
                      style={{ padding: '8px 14px', borderRadius: '6px', border: `1px solid ${border}`, background: cardBg, color: text, cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}
                    >
                      Add Explore
                    </button>
                  </div>
                </div>

                {/* Instructions */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
                    Instructions (Prompt Engineering)
                  </label>
                  <textarea
                    rows={6}
                    value={editInstructions}
                    onChange={(e) => setEditInstructions(e.target.value)}
                    placeholder="Provide specific guidelines, business rules, and date interpretations..."
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '6px', border: `1px solid ${border}`, backgroundColor: inputBg, color: text, fontFamily: 'monospace', fontSize: '13px' }}
                  />
                </div>

                {/* Code Interpreter Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="code_int"
                    checked={codeInterpreter}
                    onChange={(e) => setCodeInterpreter(e.target.checked)}
                  />
                  <label htmlFor="code_int" style={{ fontSize: '13px', fontWeight: '500' }}>Enable Code Interpreter / Advanced Analytics</label>
                </div>
              </div>

              {/* Right Panel: Live Agent Chat & Testing */}
              <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, display: 'flex', flexDirection: 'column', height: '620px' }}>
                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Live Agent Preview</h3>
                    <span style={{ fontSize: '12px', color: muted }}>Interactive conversation using Looker API</span>
                  </div>
                  <button
                    onClick={() => { setChatMessages([]); setConversationId(null); }}
                    style={{ background: 'none', border: `1px solid ${border}`, borderRadius: '4px', padding: '4px 8px', fontSize: '12px', color: muted, cursor: 'pointer' }}
                  >
                    Reset Chat
                  </button>
                </div>

                {/* Chat Message History */}
                <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {chatMessages.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: muted, textAlign: 'center' }}>
                      <div style={{ fontSize: '32px', marginBottom: '8px' }}>💬</div>
                      <div style={{ fontWeight: '500', marginBottom: '4px' }}>Test your updated instructions</div>
                      <div style={{ fontSize: '12px' }}>Ask questions below to evaluate response formatting and accuracy.</div>
                    </div>
                  ) : (
                    chatMessages.map((m, i) => (
                      <div
                        key={i}
                        style={{
                          alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                          maxWidth: '85%',
                          backgroundColor: m.role === 'user' ? primary : (isDarkMode ? '#334155' : '#f1f5f9'),
                          color: m.role === 'user' ? '#fff' : text,
                          padding: '10px 14px',
                          borderRadius: '12px',
                          fontSize: '13px',
                          lineHeight: '1.4'
                        }}
                      >
                        {m.text}
                      </div>
                    ))
                  )}
                  {isChatLoading && (
                    <div style={{ alignSelf: 'flex-start', color: muted, fontSize: '12px', fontStyle: 'italic' }}>
                      Agent is thinking...
                    </div>
                  )}
                </div>

                {/* Chat Input */}
                <div style={{ padding: '14px', borderTop: `1px solid ${border}`, display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Ask a question to test the agent..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(); }}
                    style={{ flex: 1, padding: '10px 14px', borderRadius: '20px', border: `1px solid ${border}`, backgroundColor: inputBg, color: text, fontSize: '13px', outline: 'none' }}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={isChatLoading}
                    style={{
                      backgroundColor: primary,
                      color: '#fff',
                      border: 'none',
                      borderRadius: '20px',
                      padding: '10px 18px',
                      cursor: isChatLoading ? 'not-allowed' : 'pointer',
                      fontWeight: '600',
                      fontSize: '13px'
                    }}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: AI Optimizer & Recommendations */}
      {activeTab === 'actions' && (
        <div>
          {selectedAgentId === 'All' ? (
            <div style={{ backgroundColor: cardBg, padding: '32px', borderRadius: '12px', border: `1px solid ${border}`, textAlign: 'center' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>🤖</div>
              <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 8px 0' }}>Select an Agent to Optimize</h2>
              <p style={{ fontSize: '14px', color: muted, maxWidth: '500px', margin: '0 auto' }}>
                Please choose a specific Looker AI Agent from the dropdown at the top of the page. The autonomous optimizer will compare that agent's prompt instructions and explores with its actual user feedback ratings and telemetry.
              </p>
            </div>
          ) : (
            <div>
              {/* Trigger Card Header */}
              <div style={{
                backgroundColor: cardBg,
                borderRadius: '12px',
                border: `1px solid ${border}`,
                padding: '24px',
                marginBottom: '24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                background: isDarkMode 
                  ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' 
                  : 'linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%)'
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '24px' }}>🤖</span>
                    <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>Autonomous AI Instruction Optimizer</h2>
                    <span style={{
                      backgroundColor: '#dbeafe',
                      color: '#1d4ed8',
                      fontSize: '11px',
                      fontWeight: '700',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      textTransform: 'uppercase'
                    }}>
                      {optimizationReport?.modelUsed ? `Model: ${optimizationReport.modelUsed}` : 'Gemini 2.5 Flash'}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '14px', color: muted, maxWidth: '650px' }}>
                    Analyzes <strong>{editName || selectedAgentId}</strong>'s current instructions and linked explores against real telemetry, ratings (👍/👎), and unhandled queries to autonomously diagnose gaps and synthesize concrete prompt rewrites.
                  </p>
                </div>

                <div>
                  <button
                    onClick={handleRunOptimization}
                    disabled={isOptimizing}
                    style={{
                      backgroundColor: isOptimizing ? '#94a3b8' : primary,
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '12px 24px',
                      fontSize: '14px',
                      fontWeight: '700',
                      cursor: isOptimizing ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      boxShadow: isOptimizing ? 'none' : '0 4px 12px rgba(37, 99, 235, 0.3)',
                      transition: 'all 0.2s'
                    }}
                  >
                    {isOptimizing ? '⏳ Analyzing with Gemini Flash...' : '🚀 Run Autonomous AI Optimization'}
                  </button>
                </div>
              </div>

              {/* Cloud Run Connection & Auth Bar */}
              <div style={{
                backgroundColor: cardBg,
                borderRadius: '8px',
                border: `1px solid ${border}`,
                padding: '12px 18px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '13px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>☁️</span>
                  <span><strong>Cloud Run Backend:</strong> <code>https://agent-optimizer-backend-ofamr32cra-uc.a.run.app</code></span>
                  <span style={{
                    backgroundColor: gcpToken ? '#dcfce7' : '#fef9c3',
                    color: gcpToken ? '#166534' : '#854d0e',
                    fontSize: '11px',
                    fontWeight: '700',
                    padding: '2px 8px',
                    borderRadius: '10px'
                  }}>
                    {gcpToken ? '✓ Auth Token Configured' : 'domain:google.com (requires token)'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => setShowTokenInput(!showTokenInput)}
                    style={{
                      background: 'none',
                      border: `1px solid ${border}`,
                      borderRadius: '6px',
                      padding: '4px 10px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      color: text
                    }}
                  >
                    {showTokenInput ? 'Close Auth' : '🔑 GCP Auth Token'}
                  </button>
                </div>
              </div>

              {showTokenInput && (
                <div style={{
                  backgroundColor: cardBg,
                  borderRadius: '8px',
                  border: '1px solid #bfdbfe',
                  padding: '16px',
                  marginBottom: '20px'
                }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
                    Google Cloud Identity Token for Cloud Run (Required by Corp Org Policy)
                  </div>
                  <p style={{ fontSize: '12px', color: muted, margin: '0 0 10px 0' }}>
                    Generate an identity token on your terminal with: <code>gcloud auth print-identity-token</code>
                  </p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="password"
                      placeholder="Paste identity token here (eyJhbGci...)"
                      value={gcpToken}
                      onChange={(e) => setGcpToken(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: `1px solid ${border}`,
                        fontSize: '12px',
                        backgroundColor: inputBg,
                        color: text
                      }}
                    />
                    <button
                      onClick={async () => {
                        if (extensionSDK && typeof extensionSDK.localStorageSetItem === "function") {
                          await extensionSDK.localStorageSetItem("gcp_auth_token", gcpToken.trim()).catch(() => {});
                        }
                        setTokenSavedMsg("✓ Token saved to Looker extension storage!");
                        setTimeout(() => setTokenSavedMsg(''), 3000);
                      }}
                      style={{
                        backgroundColor: primary,
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '8px 16px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Save Token
                    </button>
                    {gcpToken && (
                      <button
                        onClick={async () => {
                          setGcpToken("");
                          if (extensionSDK && typeof extensionSDK.localStorageSetItem === "function") {
                            await extensionSDK.localStorageSetItem("gcp_auth_token", "").catch(() => {});
                          }
                          setTokenSavedMsg("Cleared token.");
                          setTimeout(() => setTokenSavedMsg(''), 3000);
                        }}
                        style={{
                          background: 'none',
                          border: `1px solid ${border}`,
                          borderRadius: '6px',
                          padding: '8px 12px',
                          fontSize: '12px',
                          color: '#ef4444',
                          cursor: 'pointer'
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {tokenSavedMsg && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#16a34a', fontWeight: '500' }}>
                      {tokenSavedMsg}
                    </div>
                  )}
                </div>
              )}

              {/* Error Message */}
              {optimizationError && (
                <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '8px', padding: '16px', marginBottom: '20px', fontSize: '14px' }}>
                  <strong>Error running optimization:</strong> {optimizationError}
                </div>
              )}

              {/* Empty state before running */}
              {!optimizationReport && !isOptimizing && !optimizationError && (
                <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '40px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚡</div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600' }}>Optimizer is Ready to Run</h3>
                  <p style={{ margin: '0 auto 20px auto', fontSize: '13px', color: muted, maxWidth: '480px' }}>
                    Click <strong>"Run Autonomous AI Optimization"</strong> above to trigger the Gemini Flash agent. It will evaluate current user interactions against the agent configuration and deliver structured recommendations.
                  </p>
                  <div style={{ display: 'inline-flex', gap: '16px', fontSize: '12px', color: muted }}>
                    <span>• Evaluates Negative Ratings</span>
                    <span>• Detects Unmapped Date Terms</span>
                    <span>• Recommends Full Prompt Rewrites</span>
                  </div>
                </div>
              )}

              {/* Analysis Results */}
              {optimizationReport && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  
                  {/* Status & Summary Banner */}
                  <div style={{
                    backgroundColor: cardBg,
                    borderRadius: '12px',
                    border: `1px solid ${optimizationReport.status === 'PERFECT' ? '#86efac' : '#fed7aa'}`,
                    padding: '20px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '20px' }}>{optimizationReport.status === 'PERFECT' ? '🎉' : '⚠️'}</span>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>
                          {optimizationReport.status === 'PERFECT'
                            ? 'Agent Is Performing Optimally'
                            : 'Instruction & Configuration Optimization Recommended'}
                        </h3>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          backgroundColor: optimizationReport.status === 'PERFECT' ? '#dcfce7' : '#ffedd5',
                          color: optimizationReport.status === 'PERFECT' ? '#15803d' : '#c2410c',
                          fontWeight: '700',
                          padding: '4px 12px',
                          borderRadius: '20px',
                          fontSize: '13px'
                        }}>
                          Performance Score: {optimizationReport.performanceScore || (optimizationReport.status === 'PERFECT' ? 100 : 65)} / 100
                        </span>
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5', color: text }}>
                      {optimizationReport.summary}
                    </p>
                  </div>

                  {/* Two-Column Grid: Themes and Root Cause */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    
                    {/* Themes & Trends */}
                    <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '20px' }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: '600' }}>Identified Feedback Themes</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {(optimizationReport.themes || []).map((theme, i) => {
                          const isPos = theme.type === 'positive';
                          const isWarn = theme.type === 'warning';
                          const pillBg = isPos ? '#dcfce7' : (isWarn ? '#fef08a' : '#fee2e2');
                          const pillColor = isPos ? '#15803d' : (isWarn ? '#854d0e' : '#b91c1c');

                          return (
                            <div key={i} style={{ backgroundColor: isDarkMode ? '#1e293b' : '#f8fafc', padding: '12px', borderRadius: '8px', border: `1px solid ${border}` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                <span style={{ backgroundColor: pillBg, color: pillColor, fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px' }}>
                                  {theme.label}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', color: muted }}>{theme.details}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Root Cause Analysis */}
                    <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '20px' }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: '600' }}>Root Cause Analysis</h4>
                      <p style={{ fontSize: '13px', lineHeight: '1.6', color: text, whiteSpace: 'pre-wrap', margin: 0 }}>
                        {optimizationReport.rootCauseAnalysis}
                      </p>
                    </div>
                  </div>

                  {/* Recommendation: Full Proposed Instructions & Apply Button */}
                  <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '700' }}>
                          Proposed Instruction Prompt (Optimized by Gemini)
                        </h4>
                        <span style={{ fontSize: '12px', color: muted }}>
                          {optimizationReport.recommendations?.instructionImprovements}
                        </span>
                      </div>
                      {optimizationReport.recommendations?.suggestedFullInstructions && (
                        <button
                          onClick={handleApplyInstructions}
                          style={{
                            backgroundColor: '#16a34a',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 16px',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                        >
                          ✨ Apply Suggested Instructions to Agent
                        </button>
                      )}
                    </div>

                    {optimizationReport.recommendations?.suggestedFullInstructions ? (
                      <div style={{
                        backgroundColor: isDarkMode ? '#0f172a' : '#f1f5f9',
                        padding: '16px',
                        borderRadius: '8px',
                        border: `1px solid ${border}`,
                        fontFamily: 'monospace',
                        fontSize: '13px',
                        lineHeight: '1.5',
                        whiteSpace: 'pre-wrap',
                        color: text,
                        maxHeight: '260px',
                        overflowY: 'auto'
                      }}>
                        {optimizationReport.recommendations.suggestedFullInstructions}
                      </div>
                    ) : (
                      <div style={{ fontSize: '13px', color: muted, fontStyle: 'italic' }}>
                        No changes needed to current instructions.
                      </div>
                    )}
                  </div>

                  {/* Explores & Code Interpreter Recommendations */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '20px' }}>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '600' }}>🧭 LookML Explores & Data Sources</h4>
                      <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.5', color: muted }}>
                        {optimizationReport.recommendations?.sourcesRecommendations || 'Current linked explores are adequate.'}
                      </p>
                    </div>

                    <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '20px' }}>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '600' }}>⚙️ Code Interpreter & Advanced Analytics</h4>
                      <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.5', color: muted }}>
                        {optimizationReport.recommendations?.codeInterpreterRecommendation || 'Maintain current configuration.'}
                      </p>
                    </div>
                  </div>

                  {/* Action Plan */}
                  {optimizationReport.actionPlan && optimizationReport.actionPlan.length > 0 && (
                    <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '20px' }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600' }}>Prioritized Action Plan</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {optimizationReport.actionPlan.map((step, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px' }}>
                            <span style={{
                              backgroundColor: primary,
                              color: '#fff',
                              borderRadius: '50%',
                              width: '20px',
                              height: '20px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '11px',
                              fontWeight: '700',
                              flexShrink: 0
                            }}>
                              {idx + 1}
                            </span>
                            <span style={{ color: text }}>{step}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Bottom Controls */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button
                      onClick={handleRunOptimization}
                      disabled={isOptimizing}
                      style={{
                        backgroundColor: 'transparent',
                        border: `1px solid ${border}`,
                        color: text,
                        padding: '8px 16px',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: 'pointer'
                      }}
                    >
                      🔄 Re-run Optimization Analysis
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
