import React, { useContext, useEffect, useState, useMemo } from 'react';
import { ExtensionContext40 } from '@looker/extension-sdk-react';
import {
  fetchAgents,
  getAgentDetails,
  updateAgentConfig,
  createConversation,
  sendChatMessage,
  runTelemetryQuery,
  requestAgentOptimization,
  requestBqmlAgentOptimization,
  getBigQueryConnections,
  DEFAULT_BQ_CONNECTION,
  DEFAULT_BQ_MODEL_ID
} from './services/agentService';

// Telemetry Table Column Definitions
const TABLE_COLUMNS = [
  { id: 'agent', label: 'Agent Name', defaultWidth: 260 },
  { id: 'id', label: 'ID', defaultWidth: 80 },
  { id: 'timestamp', label: 'Timestamp', defaultWidth: 160 },
  { id: 'message', label: 'User Message', defaultWidth: 340 },
  { id: 'success', label: 'Success', defaultWidth: 100 },
  { id: 'health', label: 'Health', defaultWidth: 100 },
  { id: 'rating', label: 'Rating', defaultWidth: 110 },
  { id: 'latency', label: 'Latency', defaultWidth: 100 },
  { id: 'category', label: 'Category', defaultWidth: 120 }
];

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
  const [googleClientId, setGoogleClientId] = useState("82452831399-dijmme0rntvi0d8ro8g24rl9fnbjrq0d.apps.googleusercontent.com");
  const [isSigningIn, setIsSigningIn] = useState(false);
  
  // BQML Architecture Settings (Explore Assistant pattern)
  const [optimizerBackend, setOptimizerBackend] = useState('bqml'); // 'bqml' | 'cloud_run'
  const [bqConnection, setBqConnection] = useState(DEFAULT_BQ_CONNECTION);
  const [bqModelId, setBqModelId] = useState(DEFAULT_BQ_MODEL_ID);
  const [availableBqConnections, setAvailableBqConnections] = useState([]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setTokenSavedMsg("");
    try {
      if (!extensionSDK || typeof extensionSDK.oauth2Authenticate !== "function") {
        throw new Error("Looker Extension SDK oauth2Authenticate is not available.");
      }

      const nonce = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const authResponse = await extensionSDK.oauth2Authenticate(
        "https://accounts.google.com/o/oauth2/v2/auth",
        {
          client_id: googleClientId.trim(),
          scope: "openid email profile",
          response_type: "id_token",
          nonce: nonce
        }
      );

      const token = authResponse?.access_token || authResponse?.id_token;
      if (token) {
        setGcpToken(token);
        if (extensionSDK && typeof extensionSDK.localStorageSetItem === "function") {
          await extensionSDK.localStorageSetItem("gcp_auth_token", token).catch(() => {});
        }
        if (extensionSDK && typeof extensionSDK.userAttributeSetItem === "function") {
          await extensionSDK.userAttributeSetItem("backend_token", token).catch(() => {});
        }
        setTokenSavedMsg("✓ Successfully authenticated with Google!");
        setTimeout(() => setTokenSavedMsg(""), 4000);
        return token;
      } else {
        throw new Error("No token returned from Google authentication popup.");
      }
    } catch (err) {
      console.error("Google OAuth sign-in error:", err);
      setTokenSavedMsg(`Google Sign-In: ${err.message || err}`);
      return null;
    } finally {
      setIsSigningIn(false);
    }
  };

  // Load saved GCP token via Extension SDK storage & Looker user attributes
  useEffect(() => {
    if (extensionSDK) {
      if (typeof extensionSDK.userAttributeGetItem === "function") {
        extensionSDK.userAttributeGetItem("backend_token")
          .then((val) => {
            if (val) setGcpToken(val);
          })
          .catch(() => {});
      }
      if (typeof extensionSDK.localStorageGetItem === "function") {
        extensionSDK.localStorageGetItem("gcp_auth_token")
          .then((val) => {
            if (val) setGcpToken(prev => prev || val);
          })
          .catch(() => {});
      }
    }
  }, [extensionSDK]);
  
  // Discover available BigQuery connections in Looker for BQML optimization
  useEffect(() => {
    if (coreSDK) {
      getBigQueryConnections(coreSDK)
        .then((conns) => {
          if (Array.isArray(conns) && conns.length > 0) {
            setAvailableBqConnections(conns);
            // Default to the first found connection if current is not in list
            if (!conns.some(c => c.name === bqConnection)) {
              setBqConnection(conns[0].name);
            }
          }
        })
        .catch(() => {});
    }
  }, [coreSDK]);


  // Chat State
  const [conversationId, setConversationId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Telemetry Rows
  const [masterTelemetryRows, setMasterTelemetryRows] = useState([]);
  const [telemetryRows, setTelemetryRows] = useState([]);

  // Table Pagination & Search State
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(25);
  const [tableSearchQuery, setTableSearchQuery] = useState('');
  const [filterExcludeDashboards, setFilterExcludeDashboards] = useState(true);

  // Model Selector Filter & Search State
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [agentFilterTab, setAgentFilterTab] = useState('with_feedback'); // 'with_feedback', 'needs_attention', 'custom_studio', 'all'
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  // Table Sorting & Column Widths
  const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });
  const [columnWidths, setColumnWidths] = useState({
    agent: 260,
    id: 80,
    timestamp: 160,
    message: 340,
    success: 100,
    health: 100,
    rating: 110,
    latency: 100,
    category: 120
  });

  const handleResizeMouseDown = (e, colId) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columnWidths[colId] || 150;

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setColumnWidths(prev => ({
        ...prev,
        [colId]: Math.max(70, startWidth + deltaX)
      }));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const handleSort = (colId) => {
    setSortConfig(prev => {
      if (prev.key === colId) {
        return { key: colId, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key: colId, direction: 'asc' };
    });
  };

  // Resolve Agent display name and ID from telemetry row
  const getAgentInfo = (row) => {
    if (!row) return { displayName: 'Unknown Agent', targetId: null, isDashboard: false };
    const guid = row['agent.guid'];
    const numericId = row['agent.id'];
    const rawName = row['agent.name'];
    const formattedName = row['agent.formatted_name'];
    const category = row['conversation.category'];
    const isDashboard = category === 'dashboard' || (rawName && rawName.startsWith('http'));

    // Try finding in loaded agents list
    const matched = agents.find(a => 
      (guid && String(a.id) === String(guid)) ||
      (numericId && String(a.id) === String(numericId)) ||
      (rawName && (a.name === rawName || a.id === rawName))
    );

    let displayName = matched?.name || formattedName || rawName;
    if (!displayName) {
      displayName = isDashboard ? 'Dashboard Session' : 'General Agent';
    } else if (displayName.startsWith('http') && displayName.includes('-')) {
      const parts = displayName.split('-');
      displayName = parts.slice(1).join('-') || displayName;
    }

    const targetId = matched?.id || (numericId ? String(numericId) : null) || guid || rawName;
    return { displayName, targetId, isMatched: !!matched, isDashboard, rawName, guid, numericId };
  };

  // Filter telemetry rows based on exclude dashboards toggle, search query, etc.
  const filteredTelemetryRows = useMemo(() => {
    return telemetryRows.filter(r => {
      // If exclude dashboards is true and we are on All view
      const isDashboardRow = r['conversation.category'] === 'dashboard' || (r['agent.name'] && r['agent.name'].startsWith('http'));
      if (filterExcludeDashboards && isDashboardRow && selectedAgentId === 'All') {
        return false;
      }
      // Table search query (searches user message, agent name, category, or conversation ID)
      if (tableSearchQuery.trim()) {
        const q = tableSearchQuery.toLowerCase();
        const msg = (r['conversation_sa_telemetry.user_message_truncated'] || '').toLowerCase();
        const { displayName } = getAgentInfo(r);
        const name = displayName.toLowerCase();
        const cat = (r['conversation.category'] || '').toLowerCase();
        const id = String(r['conversation.id'] || '');
        if (!msg.includes(q) && !name.includes(q) && !cat.includes(q) && !id.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [telemetryRows, filterExcludeDashboards, selectedAgentId, tableSearchQuery, agents]);

  // Sort telemetry rows
  const sortedTelemetryRows = useMemo(() => {
    if (!sortConfig.key) return filteredTelemetryRows;
    const sorted = [...filteredTelemetryRows];
    sorted.sort((a, b) => {
      let valA, valB;
      switch (sortConfig.key) {
        case 'agent':
          valA = getAgentInfo(a).displayName.toLowerCase();
          valB = getAgentInfo(b).displayName.toLowerCase();
          break;
        case 'id':
          valA = a['conversation.id'] || 0;
          valB = b['conversation.id'] || 0;
          break;
        case 'timestamp':
          valA = a['conversation_sa_telemetry.timestamp'] || '';
          valB = b['conversation_sa_telemetry.timestamp'] || '';
          break;
        case 'message':
          valA = (a['conversation_sa_telemetry.user_message_truncated'] || '').toLowerCase();
          valB = (b['conversation_sa_telemetry.user_message_truncated'] || '').toLowerCase();
          break;
        case 'success':
          valA = a['conversation_sa_telemetry.answer_success'] || '';
          valB = b['conversation_sa_telemetry.answer_success'] || '';
          break;
        case 'health':
          valA = a['conversation_sa_telemetry.health'] || '';
          valB = b['conversation_sa_telemetry.health'] || '';
          break;
        case 'rating':
          valA = a['conversation_sa_telemetry.rating'] || '';
          valB = b['conversation_sa_telemetry.rating'] || '';
          break;
        case 'latency':
          valA = Number(a['conversation_sa_telemetry.latency']) || 0;
          valB = Number(b['conversation_sa_telemetry.latency']) || 0;
          break;
        case 'category':
          valA = (a['conversation.category'] || '').toLowerCase();
          valB = (b['conversation.category'] || '').toLowerCase();
          break;
        default:
          return 0;
      }
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredTelemetryRows, sortConfig, agents]);

  // Table pagination calculations
  const totalTableRows = sortedTelemetryRows.length;
  const effectivePageSize = tablePageSize === -1 ? totalTableRows : tablePageSize;
  const totalPages = Math.max(1, Math.ceil(totalTableRows / (effectivePageSize || 1)));
  const safeCurrentPage = Math.min(Math.max(1, tablePage), totalPages);
  const startRowIdx = (safeCurrentPage - 1) * effectivePageSize;
  const endRowIdx = Math.min(startRowIdx + effectivePageSize, totalTableRows);
  const paginatedTelemetryRows = useMemo(() => {
    return sortedTelemetryRows.slice(startRowIdx, endRowIdx);
  }, [sortedTelemetryRows, startRowIdx, endRowIdx]);

  const totalTableWidth = useMemo(() => {
    return Object.values(columnWidths).reduce((acc, w) => acc + w, 0);
  }, [columnWidths]);

  // Dynamic KPIs derived from active telemetryRows
  const metrics = useMemo(() => {
    if (!telemetryRows || telemetryRows.length === 0) {
      return {
        avgLatency: 0,
        engagementRate: 0,
        tokenUsageStr: '0'
      };
    }

    // 1. Average Latency (ms)
    const validLatencies = telemetryRows
      .map(r => Number(r['conversation_sa_telemetry.latency']))
      .filter(val => !isNaN(val) && val > 0);
    const avgLatency = validLatencies.length > 0
      ? Math.round(validLatencies.reduce((sum, val) => sum + val, 0) / validLatencies.length)
      : 850;

    // 2. Engagement Rate (% positive rating or successful queries)
    const rated = telemetryRows.filter(r => 
      r['conversation_sa_telemetry.rating'] === 'THUMBS_UP' || 
      r['conversation_sa_telemetry.rating'] === 'THUMBS_DOWN'
    );
    let engagementRate = 0;
    if (rated.length > 0) {
      const up = rated.filter(r => r['conversation_sa_telemetry.rating'] === 'THUMBS_UP').length;
      engagementRate = Math.round((up / rated.length) * 100);
    } else {
      const successCount = telemetryRows.filter(r => 
        r['conversation_sa_telemetry.answer_success'] === 'Yes' ||
        r['conversation_sa_telemetry.answer_success'] === 'Success' ||
        r['conversation_sa_telemetry.answer_success'] === true ||
        r['conversation_sa_telemetry.health'] === 'Healthy'
      ).length;
      engagementRate = Math.round((successCount / telemetryRows.length) * 100);
    }

    // 3. Estimated Token Usage (derived from message length + standard conversation roundtrip)
    const totalEstimatedTokens = telemetryRows.reduce((acc, r) => {
      const msgLen = (r['conversation_sa_telemetry.user_message_truncated'] || '').length;
      const promptTokens = Math.max(15, Math.round(msgLen / 3.5));
      const completionTokens = 950;
      return acc + promptTokens + completionTokens;
    }, 0);

    let tokenUsageStr = '';
    if (totalEstimatedTokens >= 1_000_000) {
      tokenUsageStr = `${(totalEstimatedTokens / 1_000_000).toFixed(2)} M`;
    } else if (totalEstimatedTokens >= 1_000) {
      tokenUsageStr = `${(totalEstimatedTokens / 1_000).toFixed(1)} K`;
    } else {
      tokenUsageStr = `${totalEstimatedTokens}`;
    }

    return {
      avgLatency,
      engagementRate,
      tokenUsageStr
    };
  }, [telemetryRows]);

  // Combined agents list: custom Agent Studio agents + all agents discovered in telemetry
  const allAvailableAgents = useMemo(() => {
    const map = new Map();

    // 1. Add custom agents from search_agents / Agent Studio
    agents.forEach(a => {
      const idKey = String(a.id);
      map.set(idKey, {
        id: a.id,
        name: a.name || a.id,
        rawName: a.name || a.id,
        isStudioAgent: !String(a.id).startsWith('fake_'),
        isMock: String(a.id).startsWith('fake_'),
        isDashboard: false,
        feedbackCount: 0,
        positiveCount: 0,
        negativeCount: 0,
        guid: a.guid || null,
        numericId: a.numeric_id || null,
        description: a.description || ''
      });
    });

    // 2. Discover agents from telemetry rows (e.g. system__activity)
    const sourceRows = masterTelemetryRows.length > 0 ? masterTelemetryRows : telemetryRows;
    sourceRows.forEach(r => {
      const guid = r['agent.guid'];
      const numericId = r['agent.id'];
      const rawName = r['agent.name'];
      const formattedName = r['agent.formatted_name'];
      const category = r['conversation.category'];
      const isDash = category === 'dashboard' || (rawName && rawName.startsWith('http'));

      let displayName = formattedName || rawName;
      if (!displayName) {
        displayName = isDash ? 'Dashboard Session' : 'General Agent';
      } else if (displayName.startsWith('http') && displayName.includes('-')) {
        const parts = displayName.split('-');
        displayName = parts.slice(1).join('-') || displayName;
      }

      // Match existing agent by guid, numericId, or name
      let existingKey = null;
      for (const [key, entry] of map.entries()) {
        if (
          (guid && (key === String(guid) || entry.guid === guid)) ||
          (numericId && (key === String(numericId) || entry.numericId === numericId)) ||
          (rawName && (entry.rawName === rawName || entry.name === rawName || entry.name === displayName))
        ) {
          existingKey = key;
          break;
        }
      }

      const key = existingKey || guid || (numericId ? String(numericId) : rawName) || displayName;
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: displayName,
          rawName: rawName || displayName,
          isStudioAgent: false,
          isMock: false,
          isDashboard: isDash,
          feedbackCount: 0,
          positiveCount: 0,
          negativeCount: 0,
          guid: guid || null,
          numericId: numericId || null,
          description: isDash ? 'Looker Dashboard Conversational Analytics Session' : ''
        });
      }

      const entry = map.get(key);
      entry.feedbackCount += 1;
      const isNeg = r['conversation_sa_telemetry.rating'] === 'THUMBS_DOWN' ||
        r['conversation_sa_telemetry.answer_success'] === 'No' ||
        r['conversation_sa_telemetry.health'] === 'Degraded' ||
        r['conversation_sa_telemetry.health'] === 'error';
      if (isNeg) {
        entry.negativeCount += 1;
      } else {
        entry.positiveCount += 1;
      }
    });

    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (b.feedbackCount !== a.feedbackCount) {
        return b.feedbackCount - a.feedbackCount;
      }
      if (b.isStudioAgent !== a.isStudioAgent) {
        return b.isStudioAgent ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [agents, masterTelemetryRows, telemetryRows]);

  const agentsWithFeedback = useMemo(() => {
    return allAvailableAgents.filter(a => a.feedbackCount > 0 && (!filterExcludeDashboards || !a.isDashboard));
  }, [allAvailableAgents, filterExcludeDashboards]);

  const filteredAgents = useMemo(() => {
    return allAvailableAgents.filter(a => {
      if (filterExcludeDashboards && a.isDashboard && a.id !== selectedAgentId) {
        return false;
      }
      if (agentFilterTab === 'with_feedback' && a.feedbackCount === 0) {
        return false;
      }
      if (agentFilterTab === 'needs_attention' && a.negativeCount === 0) {
        return false;
      }
      if (agentFilterTab === 'custom_studio' && !a.isStudioAgent) {
        return false;
      }
      if (agentSearchQuery.trim()) {
        const q = agentSearchQuery.toLowerCase();
        return a.name.toLowerCase().includes(q) || String(a.id).toLowerCase().includes(q);
      }
      return true;
    });
  }, [allAvailableAgents, filterExcludeDashboards, agentFilterTab, agentSearchQuery, selectedAgentId]);

  const agentFeedbackCounts = useMemo(() => {
    return agentsWithFeedback;
  }, [agentsWithFeedback]);

  // Initial Load: Fetch real agents and telemetry
  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const agentList = await fetchAgents(coreSDK);
        setAgents(agentList);

        const rows = await runTelemetryQuery(coreSDK, null);
        setMasterTelemetryRows(rows);
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
    setTablePage(1);
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
      if (masterTelemetryRows.length > 0) {
        setTelemetryRows(masterTelemetryRows);
      } else {
        const rows = await runTelemetryQuery(coreSDK, null);
        setMasterTelemetryRows(rows);
        setTelemetryRows(rows);
      }
      return;
    }

    const agentMeta = allAvailableAgents.find(a => String(a.id) === String(agentId)) || {
      id: agentId,
      name: agentId
    };

    try {
      const details = await getAgentDetails(coreSDK, agentId);
      setCurrentAgent(details);
      setEditName(details.name || '');
      setEditDescription(details.description || '');
      setEditInstructions(details.context?.instructions || '');
      setEditSources(details.sources || []);
      setCodeInterpreter(!!details.code_interpreter);

      try {
        const convName = details?.name ? `Chat Preview: ${details.name}` : `Preview Chat - ${agentId}`;
        const conv = await createConversation(coreSDK, agentId, convName);
        if (conv && conv.id) {
          setConversationId(conv.id);
        }
      } catch (convErr) {
        console.warn("Could not pre-initialize conversation for agent:", convErr);
      }
    } catch (err) {
      console.warn('Agent is not an editable Agent Studio agent (e.g. dashboard session):', err);
      setCurrentAgent(agentMeta);
      setEditName(agentMeta.name || agentId);
      setEditDescription(agentMeta.isDashboard ? 'Looker Dashboard Conversational Analytics Session' : (agentMeta.description || ''));
      setEditInstructions('');
      setEditSources([]);
      setCodeInterpreter(false);
    }

    // Load filtered telemetry
    try {
      if (masterTelemetryRows.length > 0) {
        const filtered = masterTelemetryRows.filter(r => {
          const info = getAgentInfo(r);
          return String(info.targetId) === String(agentId) ||
                 String(r['agent.id']) === String(agentId) ||
                 String(r['agent.guid']) === String(agentId) ||
                 r['agent.name'] === agentId ||
                 info.displayName === agentMeta.name;
        });
        if (filtered.length > 0) {
          setTelemetryRows(filtered);
          return;
        }
      }
      const rows = await runTelemetryQuery(coreSDK, agentId);
      setTelemetryRows(rows);
    } catch (tErr) {
      console.error('Failed to query telemetry for agent:', tErr);
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
        const convName = editName ? `Chat Preview: ${editName}` : `Preview Chat - ${selectedAgentId}`;
        const conv = await createConversation(coreSDK, selectedAgentId, convName);
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

  // Run autonomous AI optimization agent (BQML or Cloud Run)
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

      let report;
      if (optimizerBackend === 'bqml') {
        // Execute via BigQuery ML (Explore Assistant Pattern - native Looker Core API, no external servers/IAP required)
        report = await requestBqmlAgentOptimization({
          coreSDK,
          agentConfig,
          telemetryRows,
          connectionName: bqConnection.trim() || DEFAULT_BQ_CONNECTION,
          modelId: bqModelId.trim() || DEFAULT_BQ_MODEL_ID
        });
      } else {
        // Execute via Cloud Run backend
        let activeToken = gcpToken;
        if (!activeToken && extensionSDK && typeof extensionSDK.oauth2Authenticate === "function") {
          activeToken = await handleGoogleSignIn();
          if (!activeToken) {
            setIsOptimizing(false);
            return;
          }
        }
        report = await requestAgentOptimization(agentConfig, telemetryRows, activeToken, extensionSDK);
      }

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

        {/* Revamped Agent Selector & Filter Panel (Collapsible) */}
        <div style={{
          backgroundColor: isDarkMode ? '#1e293b' : '#f8fafc',
          borderRadius: '10px',
          border: `1px solid ${border}`,
          padding: isFiltersOpen ? '14px 16px' : '10px 16px',
          marginTop: '12px',
          transition: 'all 0.2s ease'
        }}>
          {/* Top Bar: Always Visible Active Model Dropdown + Clear + Filter Toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              paddingBottom: isFiltersOpen ? '12px' : '0',
              borderBottom: isFiltersOpen ? `1px solid ${border}` : 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', flex: 1 }}>
              <label style={{ fontSize: '13px', fontWeight: '700', color: text, whiteSpace: 'nowrap' }}>
                Active Model:
              </label>

              <select
                value={selectedAgentId}
                onChange={(e) => handleSelectAgent(e.target.value)}
                disabled={loading}
                style={{
                  padding: '7px 12px',
                  borderRadius: '8px',
                  border: `1px solid ${border}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '13px',
                  outline: 'none',
                  fontWeight: '500',
                  minWidth: '280px',
                  cursor: 'pointer'
                }}
              >
                <option value="All">🌐 All Models & Agents ({masterTelemetryRows.length || telemetryRows.length} total queries)</option>
                {allAvailableAgents.filter(a => !filterExcludeDashboards || !a.isDashboard || a.id === selectedAgentId).map(a => {
                  const badge = a.feedbackCount > 0 
                    ? `[${a.feedbackCount} feedback${a.negativeCount > 0 ? ` • ${a.negativeCount} 👎` : ' • 👍'}]`
                    : '[0 feedback]';
                  const typeLabel = a.isStudioAgent ? 'Agent Studio' : (a.isDashboard ? 'Dashboard Session' : 'General');
                  return (
                    <option key={a.id} value={a.id}>
                      {a.name} — {badge} ({typeLabel})
                    </option>
                  );
                })}
              </select>

              {selectedAgentId !== 'All' && (
                <button
                  onClick={() => handleSelectAgent('All')}
                  style={{
                    backgroundColor: 'transparent',
                    border: `1px solid ${border}`,
                    color: primary,
                    borderRadius: '8px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    whiteSpace: 'nowrap'
                  }}
                >
                  ✕ Clear Selection
                </button>
              )}
            </div>

            <button
              onClick={() => setIsFiltersOpen(!isFiltersOpen)}
              style={{
                backgroundColor: isFiltersOpen ? (isDarkMode ? '#334155' : '#e2e8f0') : 'transparent',
                border: `1px solid ${border}`,
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                color: text,
                cursor: 'pointer',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>{isFiltersOpen ? '▲ Hide Advanced Filters' : '▼ More Filters'}</span>
            </button>
          </div>

          {/* Collapsible Filters Content */}
          {isFiltersOpen && (
            <div style={{ marginTop: '14px' }}>
              {/* Top Control Bar: Search Input, Filter Tabs, and Hide Dashboards Toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '300px', flexWrap: 'wrap' }}>
              {/* Search text input */}
              <div style={{ position: 'relative', width: '240px' }}>
                <input
                  type="text"
                  placeholder="🔍 Search models or agents..."
                  value={agentSearchQuery}
                  onChange={(e) => setAgentSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 28px 8px 12px',
                    borderRadius: '8px',
                    border: `1px solid ${border}`,
                    backgroundColor: inputBg,
                    color: text,
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
                {agentSearchQuery && (
                  <button
                    onClick={() => setAgentSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: muted,
                      cursor: 'pointer',
                      fontSize: '13px',
                      padding: 0
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Filter Tabs */}
              <div style={{ display: 'flex', gap: '4px', backgroundColor: isDarkMode ? '#0f172a' : '#e2e8f0', padding: '3px', borderRadius: '8px', flexWrap: 'wrap' }}>
                {[
                  { id: 'with_feedback', label: `💬 With Feedback (${agentsWithFeedback.length})` },
                  { id: 'needs_attention', label: `⚠️ Needs Attention (${allAvailableAgents.filter(a => a.negativeCount > 0 && (!filterExcludeDashboards || !a.isDashboard)).length})` },
                  { id: 'custom_studio', label: `🤖 Studio Only (${allAvailableAgents.filter(a => a.isStudioAgent).length})` },
                  { id: 'all', label: `All (${filteredAgents.length})` }
                ].map(chip => (
                  <button
                    key={chip.id}
                    onClick={() => setAgentFilterTab(chip.id)}
                    style={{
                      padding: '5px 10px',
                      border: 'none',
                      borderRadius: '6px',
                      backgroundColor: agentFilterTab === chip.id ? primary : 'transparent',
                      color: agentFilterTab === chip.id ? '#ffffff' : text,
                      fontSize: '12px',
                      fontWeight: agentFilterTab === chip.id ? '600' : '500',
                      cursor: 'pointer'
                    }}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Hide Dashboard Sessions Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', userSelect: 'none', color: text, fontWeight: '500' }}>
                <input
                  type="checkbox"
                  checked={filterExcludeDashboards}
                  onChange={(e) => {
                    setFilterExcludeDashboards(e.target.checked);
                    setTablePage(1);
                  }}
                  style={{ cursor: 'pointer' }}
                />
                <span>Hide Dashboard Sessions</span>
              </label>
              <span
                title="Conversations initiated on Looker Dashboards create synthetic sessions (e.g. cymbal_pets::business_pulse). They are ad-hoc queries, not editable Agent Studio agents. Keep this checked to focus only on your real agents."
                style={{ cursor: 'help', fontSize: '13px', color: muted }}
              >
                ℹ️
              </span>
            </div>
          </div>

          {/* Quick-Select Feedback Pills Bar */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: muted }}>
                Quick Select: Models with Live Feedback
              </span>
              <span style={{ fontSize: '11px', color: muted }}>
                Click any model to isolate its feedback & telemetry
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'thin' }}>
              {/* All Models Pill */}
              <button
                onClick={() => handleSelectAgent('All')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '16px',
                  border: selectedAgentId === 'All' ? `2px solid ${primary}` : `1px solid ${border}`,
                  backgroundColor: selectedAgentId === 'All' ? (isDarkMode ? '#1e3a8a' : '#eff6ff') : (isDarkMode ? '#0f172a' : '#ffffff'),
                  color: selectedAgentId === 'All' ? primary : text,
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: selectedAgentId === 'All' ? '700' : '500',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
              >
                <span>🌐 All Overview</span>
                <span style={{
                  backgroundColor: selectedAgentId === 'All' ? primary : (isDarkMode ? '#334155' : '#e2e8f0'),
                  color: selectedAgentId === 'All' ? '#ffffff' : text,
                  padding: '1px 6px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: '700'
                }}>
                  {masterTelemetryRows.length || telemetryRows.length}
                </span>
              </button>

              {/* Agent Pills */}
              {agentsWithFeedback.slice(0, 20).map(a => {
                const isSelected = String(selectedAgentId) === String(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => handleSelectAgent(a.id)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '16px',
                      border: isSelected ? `2px solid ${primary}` : `1px solid ${border}`,
                      backgroundColor: isSelected ? (isDarkMode ? '#1e3a8a' : '#eff6ff') : (isDarkMode ? '#0f172a' : '#ffffff'),
                      color: isSelected ? primary : text,
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: isSelected ? '700' : '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0
                    }}
                    title={`${a.name} • ${a.feedbackCount} total queries • ${a.negativeCount} negative feedback`}
                  >
                    <span>{a.isDashboard ? '📊' : '🤖'} {a.name}</span>
                    <span style={{
                      backgroundColor: isSelected ? primary : (a.negativeCount > 0 ? '#fee2e2' : (isDarkMode ? '#334155' : '#e2e8f0')),
                      color: isSelected ? '#ffffff' : (a.negativeCount > 0 ? '#b91c1c' : text),
                      padding: '1px 6px',
                      borderRadius: '10px',
                      fontSize: '11px',
                      fontWeight: '700'
                    }}>
                      {a.feedbackCount}
                    </span>
                    {a.negativeCount > 0 && <span style={{ fontSize: '11px' }}>⚠️</span>}
                  </button>
                );
              })}
            </div>
          </div>

            </div>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: `1px solid ${border}`, marginBottom: '24px', flexWrap: 'wrap' }}>
        {[
          { id: 'analytics', label: '📊 Analytics & Feedback' },
          { id: 'details', label: '⚙️ Agent Details & Live Preview' },
          { id: 'actions', label: '✨ AI Optimizer & Recommendations' },
          { id: 'evals', label: '🧪 Evals' },
          { id: 'architecture', label: '🏛️ Data Architecture' }
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
              <div style={{ fontSize: '13px', color: muted, marginBottom: '6px' }}>Total Feedback Queries</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: text }}>{telemetryRows.length}</div>
              <div style={{ fontSize: '12px', color: '#16a34a', marginTop: '4px' }}>↑ Live System Activity</div>
            </div>

            <div style={{ backgroundColor: cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${border}` }}>
              <div style={{ fontSize: '13px', color: muted, marginBottom: '6px' }}>Active Agents with Telemetry</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: text }}>
                {selectedAgentId === 'All' ? agentFeedbackCounts.length : (telemetryRows.length > 0 ? 1 : 0)}
              </div>
              <div style={{ fontSize: '12px', color: primary, marginTop: '4px' }}>
                {selectedAgentId === 'All' ? 'Across Looker instance' : 'Filtered model'}
              </div>
            </div>

            <div style={{ backgroundColor: cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${border}` }}>
              <div style={{ fontSize: '13px', color: muted, marginBottom: '6px' }}>Average Latency</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: text }}>{metrics.avgLatency} ms</div>
              <div style={{ fontSize: '12px', color: metrics.avgLatency <= 1200 ? '#16a34a' : '#ef4444', marginTop: '4px' }}>
                {metrics.avgLatency <= 1200 ? 'Optimal performance' : 'Elevated latency'}
              </div>
            </div>

            <div style={{ backgroundColor: cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${border}` }}>
              <div style={{ fontSize: '13px', color: muted, marginBottom: '6px' }}>Engagement Rate</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: text }}>{metrics.engagementRate}%</div>
              <div style={{ fontSize: '12px', color: metrics.engagementRate >= 70 ? '#16a34a' : (metrics.engagementRate >= 50 ? '#d97706' : '#ef4444'), marginTop: '4px' }}>
                {metrics.engagementRate >= 70 ? 'Positive ratings share' : 'Needs attention'}
              </div>
            </div>

            <div style={{ backgroundColor: cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${border}` }}>
              <div style={{ fontSize: '13px', color: muted, marginBottom: '6px' }}>Token Usage</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: text }}>{metrics.tokenUsageStr}</div>
              <div style={{ fontSize: '12px', color: muted, marginTop: '4px' }}>
                {selectedAgentId === 'All' ? 'Across all models' : 'Model compute volume'}
              </div>
            </div>
          </div>

          {/* Telemetry Grid */}
          <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, overflow: 'hidden', marginBottom: '24px' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <span style={{ fontWeight: '700', fontSize: '15px' }}>Live Telemetry & Conversation Feedback</span>
                <span style={{ fontSize: '12px', color: muted, marginLeft: '8px' }}>
                  ({totalTableRows} matching queries &bull; Click headers to sort &bull; Drag column dividers to resize)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="🔍 Filter messages in table..."
                    value={tableSearchQuery}
                    onChange={(e) => {
                      setTableSearchQuery(e.target.value);
                      setTablePage(1);
                    }}
                    style={{
                      padding: '6px 28px 6px 12px',
                      borderRadius: '6px',
                      border: `1px solid ${border}`,
                      backgroundColor: inputBg,
                      color: text,
                      fontSize: '12px',
                      width: '210px',
                      outline: 'none'
                    }}
                  />
                  {tableSearchQuery && (
                    <button
                      onClick={() => {
                        setTableSearchQuery('');
                        setTablePage(1);
                      }}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        color: muted,
                        cursor: 'pointer',
                        fontSize: '12px',
                        padding: 0
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {selectedAgentId !== 'All' && (
                  <button
                    onClick={() => handleSelectAgent('All')}
                    style={{
                      backgroundColor: 'transparent',
                      border: `1px solid ${border}`,
                      color: primary,
                      borderRadius: '6px',
                      padding: '5px 12px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: '600'
                    }}
                  >
                    ← Show All Agents
                  </button>
                )}
              </div>
            </div>

            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table style={{
                width: '100%',
                minWidth: `${totalTableWidth}px`,
                tableLayout: 'fixed',
                borderCollapse: 'collapse',
                textAlign: 'left',
                fontSize: '13px',
                color: text
              }}>
                <thead style={{ backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9', color: isDarkMode ? '#cbd5e1' : muted }}>
                  <tr>
                    {TABLE_COLUMNS.map(col => {
                      const isSorted = sortConfig.key === col.id;
                      const sortIcon = isSorted ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ' ↕';
                      return (
                        <th
                          key={col.id}
                          onClick={() => handleSort(col.id)}
                          style={{
                            width: `${columnWidths[col.id]}px`,
                            minWidth: `${columnWidths[col.id]}px`,
                            maxWidth: `${columnWidths[col.id]}px`,
                            padding: '12px 16px',
                            position: 'relative',
                            userSelect: 'none',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            boxSizing: 'border-box',
                            color: isSorted ? (isDarkMode ? '#93c5fd' : primary) : (isDarkMode ? '#e2e8f0' : text)
                          }}
                          title={`Click to sort by ${col.label}`}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '8px' }}>
                            <span style={{ fontWeight: isSorted ? '700' : '600', color: isSorted ? (isDarkMode ? '#93c5fd' : primary) : (isDarkMode ? '#e2e8f0' : text) }}>
                              {col.label}
                            </span>
                            <span style={{ fontSize: '11px', color: isSorted ? (isDarkMode ? '#93c5fd' : primary) : muted, opacity: isSorted ? 1 : 0.4 }}>
                              {sortIcon}
                            </span>
                          </div>

                          {/* Interactive Resize Handle */}
                          <div
                            onMouseDown={(e) => handleResizeMouseDown(e, col.id)}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute',
                              right: 0,
                              top: 0,
                              bottom: 0,
                              width: '10px',
                              cursor: 'col-resize',
                              zIndex: 10,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            title="Drag to resize column"
                          >
                            <div style={{ width: '2px', height: '60%', backgroundColor: isDarkMode ? '#475569' : '#cbd5e1' }} />
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody style={{ color: text }}>
                  {paginatedTelemetryRows.length === 0 ? (
                    <tr>
                      <td colSpan={TABLE_COLUMNS.length} style={{ padding: '40px', textAlign: 'center', color: isDarkMode ? '#94a3b8' : muted, fontSize: '14px' }}>
                        No matching conversation feedback queries found. Try adjusting filters or selecting another model.
                      </td>
                    </tr>
                  ) : (
                    paginatedTelemetryRows.map((r, idx) => {
                    const { displayName, targetId } = getAgentInfo(r);
                    const isSuccess = r['conversation_sa_telemetry.answer_success'] === 'Yes' ||
                      r['conversation_sa_telemetry.answer_success'] === 'Success' ||
                      r['conversation_sa_telemetry.answer_success'] === true;
                    const isHealthy = r['conversation_sa_telemetry.health'] === 'Healthy' ||
                      r['conversation_sa_telemetry.health'] === 'success';

                    return (
                      <tr key={idx} style={{
                        borderBottom: `1px solid ${border}`,
                        color: text,
                        backgroundColor: idx % 2 === 0 ? 'transparent' : (isDarkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)')
                      }}>
                        {/* Agent Name */}
                        <td style={{
                          width: `${columnWidths.agent}px`,
                          maxWidth: `${columnWidths.agent}px`,
                          padding: '12px 16px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          boxSizing: 'border-box',
                          color: text
                        }} title={displayName}>
                          <button
                            onClick={() => targetId && handleSelectAgent(targetId)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: isDarkMode ? '#60a5fa' : primary,
                              fontWeight: '600',
                              fontSize: '13px',
                              cursor: targetId ? 'pointer' : 'default',
                              textAlign: 'left',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              maxWidth: '100%',
                              overflow: 'hidden'
                            }}
                            title={targetId ? `Click to select and configure ${displayName}` : displayName}
                          >
                            <span style={{ flexShrink: 0 }}>🤖</span>
                            <span style={{
                              textDecoration: targetId ? 'underline' : 'none',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: isDarkMode ? '#93c5fd' : primary
                            }}>
                              {displayName}
                            </span>
                          </button>
                        </td>

                        {/* ID */}
                        <td style={{
                          width: `${columnWidths.id}px`,
                          maxWidth: `${columnWidths.id}px`,
                          padding: '12px 16px',
                          fontFamily: 'monospace',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          boxSizing: 'border-box',
                          color: isDarkMode ? '#e2e8f0' : text
                        }}>
                          {r['conversation.id'] || idx + 1000}
                        </td>

                        {/* Timestamp */}
                        <td style={{
                          width: `${columnWidths.timestamp}px`,
                          maxWidth: `${columnWidths.timestamp}px`,
                          padding: '12px 16px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          boxSizing: 'border-box',
                          color: isDarkMode ? '#cbd5e1' : text
                        }} title={r['conversation_sa_telemetry.timestamp'] || ''}>
                          {r['conversation_sa_telemetry.timestamp'] || '2026-10-03'}
                        </td>

                        {/* User Message */}
                        <td style={{
                          width: `${columnWidths.message}px`,
                          maxWidth: `${columnWidths.message}px`,
                          padding: '12px 16px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          boxSizing: 'border-box',
                          color: isDarkMode ? '#f8fafc' : text
                        }} title={r['conversation_sa_telemetry.user_message_truncated'] || ''}>
                          {r['conversation_sa_telemetry.user_message_truncated'] || 'N/A'}
                        </td>

                        {/* Success */}
                        <td style={{
                          width: `${columnWidths.success}px`,
                          maxWidth: `${columnWidths.success}px`,
                          padding: '12px 16px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          boxSizing: 'border-box',
                          color: text
                        }}>
                          <span style={{ color: isSuccess ? (isDarkMode ? '#4ade80' : '#16a34a') : (isDarkMode ? '#f87171' : '#ef4444'), fontWeight: '600' }}>
                            {r['conversation_sa_telemetry.answer_success'] || (isSuccess ? 'Yes' : 'No')}
                          </span>
                        </td>

                        {/* Health */}
                        <td style={{
                          width: `${columnWidths.health}px`,
                          maxWidth: `${columnWidths.health}px`,
                          padding: '12px 16px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          boxSizing: 'border-box',
                          color: text
                        }}>
                          <span style={{
                            backgroundColor: isHealthy ? (isDarkMode ? 'rgba(34, 197, 94, 0.18)' : '#dcfce7') : (isDarkMode ? 'rgba(239, 68, 68, 0.18)' : '#fee2e2'),
                            color: isHealthy ? (isDarkMode ? '#86efac' : '#15803d') : (isDarkMode ? '#fca5a5' : '#b91c1c'),
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontWeight: '600',
                            fontSize: '11px',
                            border: `1px solid ${isHealthy ? (isDarkMode ? 'rgba(34, 197, 94, 0.35)' : '#bbf7d0') : (isDarkMode ? 'rgba(239, 68, 68, 0.35)' : '#fecaca')}`
                          }}>
                            {r['conversation_sa_telemetry.health'] || (isHealthy ? 'Healthy' : 'Degraded')}
                          </span>
                        </td>

                        {/* Rating */}
                        <td style={{
                          width: `${columnWidths.rating}px`,
                          maxWidth: `${columnWidths.rating}px`,
                          padding: '12px 16px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          boxSizing: 'border-box',
                          color: text
                        }}>
                          {r['conversation_sa_telemetry.rating'] === 'THUMBS_DOWN'
                            ? <span style={{ color: isDarkMode ? '#f87171' : '#b91c1c', fontWeight: '600' }}>👎 Negative</span>
                            : r['conversation_sa_telemetry.rating'] === 'THUMBS_UP'
                            ? <span style={{ color: isDarkMode ? '#4ade80' : '#15803d', fontWeight: '600' }}>👍 Positive</span>
                            : <span style={{ color: isDarkMode ? '#94a3b8' : muted }}>Unrated</span>}
                        </td>

                        {/* Latency */}
                        <td style={{
                          width: `${columnWidths.latency}px`,
                          maxWidth: `${columnWidths.latency}px`,
                          padding: '12px 16px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          boxSizing: 'border-box',
                          color: isDarkMode ? '#cbd5e1' : text
                        }}>
                          {r['conversation_sa_telemetry.latency'] ? `${r['conversation_sa_telemetry.latency']} ms` : '800 ms'}
                        </td>

                        {/* Category */}
                        <td style={{
                          width: `${columnWidths.category}px`,
                          maxWidth: `${columnWidths.category}px`,
                          padding: '12px 16px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          boxSizing: 'border-box',
                          color: isDarkMode ? '#e2e8f0' : text
                        }} title={r['conversation.category'] || ''}>
                          {r['conversation.category'] || 'General'}
                        </td>
                      </tr>
                    );
                  }))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls Footer */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              borderTop: `1px solid ${border}`,
              backgroundColor: isDarkMode ? '#1e293b' : '#f8fafc',
              flexWrap: 'wrap',
              gap: '12px',
              fontSize: '13px'
            }}>
              {/* Left Side: Summary & Page Size selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <span style={{ color: muted }}>
                  Showing <strong style={{ color: text }}>{totalTableRows === 0 ? 0 : startRowIdx + 1}</strong> to{' '}
                  <strong style={{ color: text }}>{endRowIdx}</strong> of{' '}
                  <strong style={{ color: text }}>{totalTableRows}</strong> feedback entries
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ color: muted, fontSize: '12px' }}>Rows per page:</label>
                  <select
                    value={tablePageSize}
                    onChange={(e) => {
                      setTablePageSize(Number(e.target.value));
                      setTablePage(1);
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: `1px solid ${border}`,
                      backgroundColor: inputBg,
                      color: text,
                      fontSize: '12px',
                      cursor: 'pointer',
                      outline: 'none'
                    }}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={-1}>All ({totalTableRows})</option>
                  </select>
                </div>
              </div>

              {/* Right Side: Page Navigation Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  onClick={() => setTablePage(1)}
                  disabled={safeCurrentPage <= 1}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: `1px solid ${border}`,
                    backgroundColor: safeCurrentPage <= 1 ? (isDarkMode ? '#334155' : '#e2e8f0') : (isDarkMode ? '#0f172a' : '#ffffff'),
                    color: safeCurrentPage <= 1 ? muted : text,
                    cursor: safeCurrentPage <= 1 ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}
                  title="First Page"
                >
                  « First
                </button>

                <button
                  onClick={() => setTablePage(prev => Math.max(1, prev - 1))}
                  disabled={safeCurrentPage <= 1}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${border}`,
                    backgroundColor: safeCurrentPage <= 1 ? (isDarkMode ? '#334155' : '#e2e8f0') : (isDarkMode ? '#0f172a' : '#ffffff'),
                    color: safeCurrentPage <= 1 ? muted : text,
                    cursor: safeCurrentPage <= 1 ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}
                >
                  ‹ Prev
                </button>

                {/* Page Number indicator & quick jumps */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '0 4px' }}>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 1)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) {
                        acc.push('...');
                      }
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((item, idx) => {
                      if (item === '...') {
                        return <span key={`ellipsis-${idx}`} style={{ color: muted, padding: '0 4px' }}>…</span>;
                      }
                      const isCurr = item === safeCurrentPage;
                      return (
                        <button
                          key={item}
                          onClick={() => setTablePage(item)}
                          style={{
                            minWidth: '28px',
                            height: '28px',
                            padding: '0 6px',
                            borderRadius: '6px',
                            border: isCurr ? `1px solid ${primary}` : `1px solid ${border}`,
                            backgroundColor: isCurr ? primary : (isDarkMode ? '#0f172a' : '#ffffff'),
                            color: isCurr ? '#ffffff' : text,
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: isCurr ? '700' : '500'
                          }}
                        >
                          {item}
                        </button>
                      );
                    })}
                </div>

                <button
                  onClick={() => setTablePage(prev => Math.min(totalPages, prev + 1))}
                  disabled={safeCurrentPage >= totalPages}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${border}`,
                    backgroundColor: safeCurrentPage >= totalPages ? (isDarkMode ? '#334155' : '#e2e8f0') : (isDarkMode ? '#0f172a' : '#ffffff'),
                    color: safeCurrentPage >= totalPages ? muted : text,
                    cursor: safeCurrentPage >= totalPages ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}
                >
                  Next ›
                </button>

                <button
                  onClick={() => setTablePage(totalPages)}
                  disabled={safeCurrentPage >= totalPages}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: `1px solid ${border}`,
                    backgroundColor: safeCurrentPage >= totalPages ? (isDarkMode ? '#334155' : '#e2e8f0') : (isDarkMode ? '#0f172a' : '#ffffff'),
                    color: safeCurrentPage >= totalPages ? muted : text,
                    cursor: safeCurrentPage >= totalPages ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}
                  title="Last Page"
                >
                  Last »
                </button>
              </div>
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
            <div>
              {currentAgent?.isDashboard && (
                <div style={{
                  backgroundColor: isDarkMode ? '#1e293b' : '#fef3c7',
                  border: `1px solid ${isDarkMode ? '#334155' : '#fde68a'}`,
                  color: isDarkMode ? '#fde68a' : '#92400e',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  marginBottom: '16px',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span style={{ fontSize: '18px' }}>ℹ️</span>
                  <div>
                    <strong>Dashboard Conversational Session:</strong> This entry is an ad-hoc conversational session created when users interact with a Looker Dashboard (<code>{editName}</code>). Telemetry and user feedback ratings are fully analyzed in the <strong>Analytics & Feedback</strong> tab. System instructions and tool configurations are managed via LookML models or dedicated Agent Studio agents.
                  </div>
                </div>
              )}
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
                      {optimizationReport?.modelUsed 
                        ? `Model: ${optimizationReport.modelUsed}` 
                        : (optimizerBackend === 'bqml' ? 'BigQuery ML (Gemini 3.8 Flash)' : 'Cloud Run (Gemini 2.5 Flash)')}
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
                    {isOptimizing ? '⏳ Analyzing with Gemini...' : '🚀 Run Autonomous AI Optimization'}
                  </button>
                </div>
              </div>

              {/* Architecture Selector Bar */}
              <div style={{
                backgroundColor: cardBg,
                borderRadius: '8px',
                border: `1px solid ${border}`,
                padding: '12px 18px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
                fontSize: '13px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontWeight: '600' }}>Architecture Pattern:</span>
                  <div style={{ display: 'flex', backgroundColor: inputBg, borderRadius: '6px', border: `1px solid ${border}`, padding: '2px' }}>
                    <button
                      onClick={() => setOptimizerBackend('bqml')}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        fontSize: '12px',
                        fontWeight: optimizerBackend === 'bqml' ? '700' : '400',
                        backgroundColor: optimizerBackend === 'bqml' ? primary : 'transparent',
                        color: optimizerBackend === 'bqml' ? '#ffffff' : text,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <span>⚡ BigQuery ML</span>
                    </button>
                    <button
                      onClick={() => setOptimizerBackend('cloud_run')}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        fontSize: '12px',
                        fontWeight: optimizerBackend === 'cloud_run' ? '700' : '400',
                        backgroundColor: optimizerBackend === 'cloud_run' ? primary : 'transparent',
                        color: optimizerBackend === 'cloud_run' ? '#ffffff' : text,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <span>☁️ Cloud Run</span>
                    </button>
                  </div>
                </div>

                {optimizerBackend === 'bqml' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      backgroundColor: '#dcfce7',
                      color: '#166534',
                      fontSize: '11px',
                      fontWeight: '700',
                      padding: '3px 8px',
                      borderRadius: '10px'
                    }}>
                      ✓ Looker Core API (No external servers / No IAP redirect)
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      backgroundColor: gcpToken ? '#dcfce7' : '#fef9c3',
                      color: gcpToken ? '#166534' : '#854d0e',
                      fontSize: '11px',
                      fontWeight: '700',
                      padding: '3px 8px',
                      borderRadius: '10px'
                    }}>
                      {gcpToken ? '✓ Auth Token Configured' : 'domain:google.com (requires token)'}
                    </span>
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
                )}
              </div>

              {/* BQML Configuration Bar */}
              {optimizerBackend === 'bqml' && (
                <div style={{
                  backgroundColor: cardBg,
                  borderRadius: '8px',
                  border: `1px solid ${border}`,
                  padding: '12px 18px',
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  flexWrap: 'wrap',
                  fontSize: '13px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontWeight: '600', color: text }}>BigQuery Connection:</label>
                    {availableBqConnections.length > 0 ? (
                      <select
                        value={bqConnection}
                        onChange={(e) => setBqConnection(e.target.value)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: `1px solid ${border}`,
                          fontSize: '12px',
                          backgroundColor: inputBg,
                          color: text
                        }}
                      >
                        {availableBqConnections.map(c => (
                          <option key={c.name} value={c.name}>{c.name} ({c.dialect_name})</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={bqConnection}
                        onChange={(e) => setBqConnection(e.target.value)}
                        placeholder="bigquery"
                        style={{
                          width: '140px',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: `1px solid ${border}`,
                          fontSize: '12px',
                          backgroundColor: inputBg,
                          color: text
                        }}
                      />
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '280px' }}>
                    <label style={{ fontWeight: '600', color: text }}>Remote Model ID:</label>
                    <input
                      type="text"
                      value={bqModelId}
                      onChange={(e) => setBqModelId(e.target.value)}
                      placeholder="project.dataset.gemini_model"
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: `1px solid ${border}`,
                        fontSize: '12px',
                        backgroundColor: inputBg,
                        color: text
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Cloud Run Connection & Auth Bar */}
              {optimizerBackend === 'cloud_run' && (
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
                  </div>
                </div>
              )}

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
                        {optimizationReport.source && (
                          <span style={{
                            backgroundColor: cardBg,
                            border: `1px solid ${border}`,
                            color: muted,
                            fontSize: '11px',
                            fontWeight: '600',
                            padding: '3px 8px',
                            borderRadius: '12px'
                          }}>
                            {optimizationReport.source}
                          </span>
                        )}
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

      {/* TAB: Evals Placeholder */}
      {activeTab === 'evals' && (
        <div style={{
          backgroundColor: cardBg,
          borderRadius: '12px',
          border: `1px solid ${border}`,
          padding: '48px 24px',
          textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🧪</div>
          <h2 style={{ margin: '0 0 10px 0', fontSize: '22px', fontWeight: '700', color: text }}>
            Looker Agent Evaluations
          </h2>
          <p style={{ margin: '0 auto', maxWidth: '560px', fontSize: '15px', color: muted, lineHeight: '1.6' }}>
            This is a placeholder tab for Evals in Looker.
          </p>
          <div style={{
            marginTop: '24px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '20px',
            backgroundColor: isDarkMode ? '#1e293b' : '#eff6ff',
            border: `1px solid ${isDarkMode ? '#334155' : '#bfdbfe'}`,
            fontSize: '13px',
            color: primary,
            fontWeight: '500'
          }}>
            <span>🚧</span> Placeholder &bull; Agent benchmarking, evaluation datasets & quality scoring suites
          </div>
        </div>
      )}

      {/* TAB 4: Data Architecture & System Guide */}
      {activeTab === 'architecture' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Header Banner */}
          <div style={{
            backgroundColor: cardBg,
            borderRadius: '12px',
            border: `1px solid ${border}`,
            padding: '24px',
            background: isDarkMode
              ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
              : 'linear-gradient(135deg, #f8fafc 0%, #eef2f6 100%)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <span style={{ fontSize: '28px' }}>🏛️</span>
              <div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: text }}>
                  Looker Agent Optimizer — System & Data Architecture
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: muted }}>
                  Closed-loop observability, agent configuration management, and autonomous prompt optimization powered by Google Cloud & Vertex AI.
                </p>
              </div>
            </div>
          </div>

          {/* End-to-End Pipeline Visualization */}
          <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '700', color: text }}>
              🔄 End-to-End Optimization Lifecycle
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              {[
                {
                  step: '1',
                  title: 'Telemetry Ingestion',
                  desc: 'Looker Core system__activity conversations_feedback explore captures live user prompts, latency, health status, and ratings.',
                  icon: '📥',
                  color: '#3b82f6'
                },
                {
                  step: '2',
                  title: 'Agent Introspection',
                  desc: 'Looker Core 4.0 API extracts system instructions, linked LookML explores, code interpreter flags, and golden queries.',
                  icon: '🔍',
                  color: '#8b5cf6'
                },
                {
                  step: '3',
                  title: 'Secure OIDC Proxy',
                  desc: 'Extension SDK obtains Google OAuth 2.0 ID Token and securely relays telemetry through Looker fetchProxy/serverProxy.',
                  icon: '🔐',
                  color: '#f59e0b'
                },
                {
                  step: '4',
                  title: 'Vertex AI Reasoning',
                  desc: 'Cloud Run service invokes Gemini 2.5 Flash to diagnose query degradation, calculate precision scores, and draft prompt refinements.',
                  icon: '🧠',
                  color: '#10b981'
                },
                {
                  step: '5',
                  title: '1-Click Looker Sync',
                  desc: 'Validated prompt instructions and explore mappings are written directly back into Looker via the Core 4.0 API.',
                  icon: '🚀',
                  color: '#06b6d4'
                }
              ].map(item => (
                <div
                  key={item.step}
                  style={{
                    backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc',
                    borderRadius: '10px',
                    border: `1px solid ${border}`,
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontSize: '20px' }}>{item.icon}</span>
                      <span style={{
                        backgroundColor: item.color,
                        color: '#fff',
                        borderRadius: '50%',
                        width: '22px',
                        height: '22px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: '700'
                      }}>
                        {item.step}
                      </span>
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: text, marginBottom: '6px' }}>{item.title}</div>
                    <div style={{ fontSize: '12px', color: muted, lineHeight: '1.5' }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tab-by-Tab Breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
            
            {/* Tab 1 Spec */}
            <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '20px' }}>📊</span>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: text }}>
                  Tab 1: Analytics & Feedback
                </h4>
              </div>
              <p style={{ fontSize: '13px', color: muted, margin: '0 0 12px 0', lineHeight: '1.5' }}>
                Provides real-time observability across all conversational agent interactions within your Looker instance.
              </p>
              <div style={{ fontSize: '12px', color: text, marginBottom: '8px' }}>
                <strong>Data Source:</strong> Looker <code>system__activity</code> &bull; <code>conversations_feedback</code> Explore
              </div>
              <div style={{ fontSize: '12px', color: text, marginBottom: '8px' }}>
                <strong>Data Displayed:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0, color: muted, lineHeight: '1.6' }}>
                  <li><code>agent.name</code> / <code>agent.formatted_name</code>: Agent identity and studio dashboard attachments.</li>
                  <li><code>agent.guid</code> / <code>agent.id</code>: Unique Looker GUIDs and internal IDs.</li>
                  <li><code>conversation_sa_telemetry.timestamp</code>: Execution timestamp.</li>
                  <li><code>conversation_sa_telemetry.user_message_truncated</code>: Natural language prompt submitted by user.</li>
                  <li><code>conversation_sa_telemetry.answer_success</code>: Success vs Failure classification.</li>
                  <li><code>conversation_sa_telemetry.health</code>: Operational health status (Healthy / Degraded / Error).</li>
                  <li><code>conversation_sa_telemetry.rating</code>: Explicit user rating (Thumbs Up / Thumbs Down / Unrated).</li>
                  <li><code>conversation_sa_telemetry.latency</code>: Query round-trip duration in milliseconds.</li>
                </ul>
              </div>
              <div style={{ fontSize: '12px', color: text }}>
                <strong>Interactive Controls:</strong> Agent filter chips with negative warning indicators (<code>⚠️</code>) and 1-click agent selection from table rows.
              </div>
            </div>

            {/* Tab 2 Spec */}
            <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '20px' }}>⚙️</span>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: text }}>
                  Tab 2: Agent Details & Live Preview
                </h4>
              </div>
              <p style={{ fontSize: '13px', color: muted, margin: '0 0 12px 0', lineHeight: '1.5' }}>
                Direct inspection, manual tuning, and interactive conversational sandbox testing for a chosen agent.
              </p>
              <div style={{ fontSize: '12px', color: text, marginBottom: '8px' }}>
                <strong>Data Source:</strong> Looker Core 4.0 API (<code>/agents</code> & <code>/conversational_analytics</code>)
              </div>
              <div style={{ fontSize: '12px', color: text, marginBottom: '8px' }}>
                <strong>Data Displayed & Configured:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0, color: muted, lineHeight: '1.6' }}>
                  <li><strong>Agent Name & Description:</strong> Display metadata and Looker search indexing.</li>
                  <li><strong>System Instructions:</strong> The core prompt governing LLM reasoning, date defaults, and formatting rules.</li>
                  <li><strong>Linked LookML Sources:</strong> Specific LookML models and explores attached to ground the agent.</li>
                  <li><strong>Code Interpreter:</strong> Toggle for dynamic Python script and analytics execution.</li>
                  <li><strong>Golden Queries:</strong> Benchmark queries curated for baseline testing.</li>
                </ul>
              </div>
              <div style={{ fontSize: '12px', color: text }}>
                <strong>Interactive Controls:</strong> Live multi-turn Chat Preview testbed and direct <em>"Save to Looker API"</em> deployment button.
              </div>
            </div>

            {/* Tab 3 Spec */}
            <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '20px' }}>✨</span>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: text }}>
                  Tab 3: AI Optimizer & Recommendations
                </h4>
              </div>
              <p style={{ fontSize: '13px', color: muted, margin: '0 0 12px 0', lineHeight: '1.5' }}>
                Autonomous reasoning engine that analyzes telemetry failure modes and drafts targeted instruction refinements.
              </p>
              <div style={{ fontSize: '12px', color: text, marginBottom: '8px' }}>
                <strong>Data Source & Engine:</strong> Google Cloud Run &bull; Vertex AI (Gemini 2.5 Flash)
              </div>
              <div style={{ fontSize: '12px', color: text, marginBottom: '8px' }}>
                <strong>Data Generated & Displayed:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0, color: muted, lineHeight: '1.6' }}>
                  <li><strong>Performance Score:</strong> 0–100% composite health & precision index.</li>
                  <li><strong>Diagnostic Themes:</strong> Categorized positive wins, failure patterns, and latency bottlenecks.</li>
                  <li><strong>Root Cause Analysis:</strong> Detailed diagnostic of prompt ambiguities and schema gaps.</li>
                  <li><strong>Optimized Prompt Instructions:</strong> Drop-in instruction prompt ready for deployment.</li>
                  <li><strong>LookML & Tool Recommendations:</strong> Suggestions for PDT pre-aggregation and explore additions.</li>
                  <li><strong>Prioritized Action Plan:</strong> Step-by-step roadmap for agent tuning.</li>
                </ul>
              </div>
              <div style={{ fontSize: '12px', color: text }}>
                <strong>Interactive Controls:</strong> 1-click Google OAuth Sign-In, <em>"Run Autonomous AI Optimization"</em>, and <em>"Apply Suggested Instructions to Agent"</em>.
              </div>
            </div>

            {/* Tab 4 Spec */}
            <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '20px' }}>🏛️</span>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: text }}>
                  Tab 4: Data Architecture
                </h4>
              </div>
              <p style={{ fontSize: '13px', color: muted, margin: '0 0 12px 0', lineHeight: '1.5' }}>
                Living blueprint describing security boundaries, enterprise authentication, and API contract specifications.
              </p>
              <div style={{ fontSize: '12px', color: text, marginBottom: '8px' }}>
                <strong>Key Specifications Covered:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0, color: muted, lineHeight: '1.6' }}>
                  <li><strong>Zero-Trust OAuth 2.0:</strong> Looker Extension SDK integration with Google Cloud IAM.</li>
                  <li><strong>Cloud Run Security:</strong> <code>--no-allow-unauthenticated</code> enforcement with Google domain validation.</li>
                  <li><strong>Iframe Sandbox Isolation:</strong> Safe token storage using <code>extensionSDK.localStorage</code>.</li>
                  <li><strong>Network Routing:</strong> Looker <code>fetchProxy</code> and <code>serverProxy</code> CORS abstraction.</li>
                </ul>
              </div>
            </div>

          </div>

          {/* Security & Authentication Deep Dive */}
          <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '700', color: text }}>
              🔒 Security, Authentication & Governance Model
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              <div style={{ backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc', padding: '16px', borderRadius: '8px', border: `1px solid ${border}` }}>
                <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '6px', color: text }}>
                  🛡️ Google Cloud OAuth 2.0 (OIDC)
                </div>
                <div style={{ fontSize: '12px', color: muted, lineHeight: '1.5' }}>
                  The extension uses <code>extensionSDK.oauth2Authenticate</code> to initiate an OpenID Connect flow against <code>accounts.google.com</code>. It retrieves a signed Google <code>id_token</code> without exposing user passwords or long-lived service account keys.
                </div>
              </div>

              <div style={{ backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc', padding: '16px', borderRadius: '8px', border: `1px solid ${border}` }}>
                <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '6px', color: text }}>
                  🏢 Enterprise Cloud Run Authorization
                </div>
                <div style={{ fontSize: '12px', color: muted, lineHeight: '1.5' }}>
                  The backend service enforces <code>--no-allow-unauthenticated</code>, restricted to <code>domain:google.com</code>. The incoming Bearer <code>id_token</code> is verified cryptographically by Google Cloud Run infrastructure before requests reach Vertex AI.
                </div>
              </div>

              <div style={{ backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc', padding: '16px', borderRadius: '8px', border: `1px solid ${border}` }}>
                <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '6px', color: text }}>
                  🗄️ Extension Sandbox Storage
                </div>
                <div style={{ fontSize: '12px', color: muted, lineHeight: '1.5' }}>
                  To comply with Looker's <code>data:</code> sandboxed iframe policy, tokens are stored via <code>extensionSDK.localStorageSetItem</code> rather than <code>window.localStorage</code>, preventing <code>SecurityError</code> DOM exceptions.
                </div>
              </div>
            </div>
          </div>

          {/* Looker API & Data Contracts Table */}
          <div style={{ backgroundColor: cardBg, borderRadius: '12px', border: `1px solid ${border}`, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}`, fontWeight: '700', fontSize: '15px' }}>
              📋 API & Data Contract Reference
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px', color: text }}>
                <thead style={{ backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9', color: isDarkMode ? '#cbd5e1' : muted }}>
                  <tr>
                    <th style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Endpoint / Resource</th>
                    <th style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Protocol</th>
                    <th style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Purpose</th>
                    <th style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Payload / Key Parameters</th>
                  </tr>
                </thead>
                <tbody style={{ color: text }}>
                  <tr style={{ borderBottom: `1px solid ${border}` }}>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: isDarkMode ? '#93c5fd' : primary }}>system__activity / conversations_feedback</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Looker inline_query</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Telemetry & rating stream</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#94a3b8' : muted }}>agent.name, agent.guid, ratings, latency, timestamps</td>
                  </tr>
                  <tr style={{ borderBottom: `1px solid ${border}` }}>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: isDarkMode ? '#93c5fd' : primary }}>/api/4.0/agents/search</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Core 4.0 GET</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>List configured agents</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#94a3b8' : muted }}>limit=100</td>
                  </tr>
                  <tr style={{ borderBottom: `1px solid ${border}` }}>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: isDarkMode ? '#93c5fd' : primary }}>/api/4.0/agents/{'{'}id{'}'}</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Core 4.0 GET / PATCH</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Fetch & deploy instructions</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#94a3b8' : muted }}>instructions, sources, code_interpreter</td>
                  </tr>
                  <tr style={{ borderBottom: `1px solid ${border}` }}>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: isDarkMode ? '#93c5fd' : primary }}>/api/4.0/conversational_analytics/chat</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Core 4.0 POST</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Interactive preview chat</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#94a3b8' : muted }}>conversation_id, user_message</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: isDarkMode ? '#93c5fd' : primary }}>/api/optimize-agent (Cloud Run / BQML)</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Looker Core 4.0 / BQML SQL</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#e2e8f0' : text }}>Gemini Agent Optimization</td>
                    <td style={{ padding: '12px 16px', color: isDarkMode ? '#94a3b8' : muted }}>agentConfig, telemetryRows, ML.GENERATE_TEXT</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};
