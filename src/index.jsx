import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { ExtensionProvider40, ExtensionContext40 } from '@looker/extension-sdk-react'
import { ComponentsProvider } from '@looker/components'
import { App } from './App'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Extension render error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "32px", fontFamily: "sans-serif", color: "#c5221f" }}>
          <h2>Extension Error</h2>
          <pre style={{ background: "#fce8e6", padding: "16px", borderRadius: "8px", overflowX: "auto" }}>
            {this.state.error?.stack || this.state.error?.toString()}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const LoadingFallback = () => (
  <div style={{ padding: "48px", textAlign: "center", fontFamily: "sans-serif", color: "#5f6368" }}>
    <div style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
      Connecting to Looker Extension Host...
    </div>
    <div style={{ fontSize: "14px" }}>Loading Agent Feedback Optimizer</div>
  </div>
);


// Standalone fallback SDK when testing directly in a browser tab outside of Looker iframe
const standaloneCoreSDK = {
  ok: async (val) => (typeof val === 'function' ? val() : val),
  search_agents: async () => [],
  get_agent: async () => null,
  update_agent: async () => ({ ok: true }),
  create_conversation: async () => ({ id: 'standalone_conv' }),
  conversational_analytics_chat: async () => [{ role: 'agent', text: 'Standalone browser preview mode.' }],
  run_inline_query: async () => []
}

const StandaloneProvider = ({ children }) => {
  return (
    <ExtensionContext40.Provider value={{ coreSDK: standaloneCoreSDK, extensionSDK: {} }}>
      {children}
    </ExtensionContext40.Provider>
  )
}

// In Looker, the extension is loaded inside an iframe (window !== window.parent)
const isStandalone = typeof window !== 'undefined' && window === window.parent

const Root = () => {
  if (isStandalone) {
    return (
      <ErrorBoundary>
        <StandaloneProvider>
          <ComponentsProvider>
            <App isStandalone={true} />
          </ComponentsProvider>
        </StandaloneProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ExtensionProvider40
        chattyTimeout={30000}
        loadingComponent={<LoadingFallback />}
      >
        <ComponentsProvider>
          <App isStandalone={false} />
        </ComponentsProvider>
      </ExtensionProvider40>
    </ErrorBoundary>
  );
};

const mount = () => {
  if (!document.body) {
    window.addEventListener('DOMContentLoaded', mount);
    return;
  }
  let container = document.getElementById('extension-root')
  if (!container) {
    container = document.createElement('div')
    container.id = 'extension-root'
    container.style.height = '100%'
    container.style.width = '100%'
    document.body.appendChild(container)
  }
  ReactDOM.render(<Root />, container)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount)
} else {
  mount()
}
