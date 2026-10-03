import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { ExtensionProvider40, ExtensionContext40 } from '@looker/extension-sdk-react'
import { ComponentsProvider } from '@looker/components'
import { App } from './App'

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
      <StandaloneProvider>
        <ComponentsProvider>
          <App isStandalone={true} />
        </ComponentsProvider>
      </StandaloneProvider>
    )
  }

  return (
    <ExtensionProvider40 chattyTimeout={-1}>
      <ComponentsProvider>
        <App isStandalone={false} />
      </ComponentsProvider>
    </ExtensionProvider40>
  )
}

window.addEventListener('DOMContentLoaded', () => {
  let container = document.getElementById('extension-root')
  if (!container) {
    container = document.createElement('div')
    container.id = 'extension-root'
    container.style.height = '100%'
    container.style.width = '100%'
    document.body.appendChild(container)
  }
  ReactDOM.render(<Root />, container)
})
