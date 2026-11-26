import { DATA_RETRIEVAL_SETTINGS } from '../features/data-retrieval/settings.js';
import { VALIDATION_SETTINGS } from '../features/validation/settings.js';
import { CONVERSATION_SETTINGS } from '../conversations/settings.js';
import { RUNTIME_SETTINGS } from '../agent-runtime/settings.js?v=20261126-detailed-output-v1';
import { INSTANCE_SETTINGS } from '../features/data-retrieval/instance-settings.js';
import { PROPOSAL_SETTINGS } from '../features/proposals/settings.js';
import { CHAT_SYSTEM_SETTINGS } from '../conversations/chat-system-settings.js';
import { createSettingsRegistry } from './registry.js';

export function createAssistantSettingsRegistry() {
  const registry = createSettingsRegistry();
  registry.register('dataRetrieval', DATA_RETRIEVAL_SETTINGS);
  registry.register('validation', VALIDATION_SETTINGS);
  registry.register('conversations', CONVERSATION_SETTINGS);
  registry.register('chatSystem', CHAT_SYSTEM_SETTINGS);
  registry.register('agentRuntime', RUNTIME_SETTINGS);
  registry.register('instances', INSTANCE_SETTINGS);
  registry.register('proposals', PROPOSAL_SETTINGS);
  return registry;
}
