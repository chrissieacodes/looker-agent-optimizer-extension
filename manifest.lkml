project_name: "agent_optimizer"

application: agent_optimizer {
  label: "Agent Feedback Optimizer"

  # For local development with live reload:
  #url: "http://localhost:8080/bundle.js"

  # For production deployment (uncomment when uploading bundle.js directly):
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
      "all_conversation_messages"
    ]
    use_embeds: yes
    use_form_submit: yes
    use_clipboard: yes
    navigation: yes
    new_window: yes
    scoped_user_attributes: []
    external_api_urls: []
  }
}
