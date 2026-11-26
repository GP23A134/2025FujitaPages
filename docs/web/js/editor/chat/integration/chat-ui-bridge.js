import { upsertAgentHistoryRecord } from './agent-history-adapter.js';

export function createChatUiBridge({
  editor,
  getCurrentConversation,
  getConversations,
  createConversation,
  currentDataHash,
  getPreview,
  getPreviewDialog,
  closePreview,
  renderConversation,
  updateHistoryList,
  persistSavedConversations,
  renderPromptExamples,
  reportPreviewError,
  setStatus
}) {
  let agentPreviewProxies = [];
  let agentPreviewOwner = null;

  const clearAgentPreviewProxy = () => {
    if (agentPreviewProxies.length && agentPreviewOwner) {
      const proxies = new Set(agentPreviewProxies);
      const remaining = agentPreviewOwner.items.filter((item) => !proxies.has(item));
      agentPreviewOwner.items.splice(0, agentPreviewOwner.items.length, ...remaining);
    }
    agentPreviewProxies = [];
    agentPreviewOwner = null;
  };

  return Object.freeze({
    async previewProposal({ item, proposals = [item], alternativeGroups = [], selectedAlternatives = {}, onSelectAlternative, onApply, onDismiss }) {
      if (!item?.proposal || typeof onApply !== 'function') throw new TypeError('提案のプレビュー情報が不足しています。');
      const proposalPreview = getPreview();
      if (!proposalPreview) throw new Error('提案プレビューを利用できません。');
      if (agentPreviewProxies.length) closePreview();
      agentPreviewOwner = getCurrentConversation();
      if (!agentPreviewOwner?.items) throw new Error('提案の相談を開けません。');
      const responseGroupId = `agent_preview_${Date.now()}`;
      const sourceItems = [...new Set([item, ...proposals])].filter((candidate) => candidate?.proposal && Array.isArray(candidate.operations));
      const groupByProposal = new Map();
      alternativeGroups.forEach((group) => group.proposalIds.forEach((id) => groupByProposal.set(id, group)));
      const selectedAlternativeSources = new Map(Object.entries(selectedAlternatives)
        .map(([groupId, proposalId]) => [groupId, sourceItems.find((candidate) => candidate.proposal.id === proposalId) || null]));
      agentPreviewProxies = sourceItems.map((sourceItem, index) => ({
        type: 'proposal',
        id: `${responseGroupId}_${index + 1}`,
        responseGroupId,
        proposal: {
          id: sourceItem.proposal.id,
          title: sourceItem.proposal.title,
          summary: sourceItem.proposal.summary,
          reason: sourceItem.proposal.reason,
          uncertainties: sourceItem.proposal.uncertainties || [],
          questions: [],
          conflictGroups: [],
          operations: sourceItem.operations
        },
        selectedConflictChoices: {},
        excludedOperationIndexes: new Set(),
        editableIds: sourceItem.editableIds,
        availableIds: sourceItem.availableIds,
        operationPolicy: sourceItem.operationPolicy,
        status: 'pending',
        agentAlternativeGroupId: groupByProposal.get(sourceItem.proposal.id)?.id || null,
        agentAlternativeSelected: () => {
          const group = groupByProposal.get(sourceItem.proposal.id);
          return !group || selectedAlternativeSources.get(group.id) === sourceItem;
        },
        agentSelectAlternative: () => {
          const group = groupByProposal.get(sourceItem.proposal.id);
          if (!group) return;
          selectedAlternativeSources.set(group.id, sourceItem);
          onSelectAlternative?.(group.id, sourceItem.proposal.id);
        },
        agentApply: async (operationIndexes) => {
          const result = await onApply(sourceItem, operationIndexes);
          agentPreviewProxies.forEach((candidate, candidateIndex) => {
            candidate.status = sourceItems[candidateIndex]?.status === 'alternative_excluded' ? 'alternative-rejected' : candidate.status;
          });
          return result;
        },
        agentDismiss: () => onDismiss?.(sourceItem)
      }));
      const proxy = agentPreviewProxies[sourceItems.indexOf(item)] || agentPreviewProxies[0];
      proxy.agentSelectAlternative?.();
      agentPreviewOwner.items.push(...agentPreviewProxies);
      try {
        const baseDataHash = await currentDataHash();
        agentPreviewProxies.forEach((candidate) => { candidate.baseDataHash = baseDataHash; });
        await proposalPreview.showPreview(proxy);
      } catch (error) {
        closePreview();
        throw error;
      }
      return true;
    },
    clearPreviewProxy: clearAgentPreviewProxy,
    isAgentProposal(item) { return typeof item?.agentApply === 'function'; },
    upsertHistory(record) {
      return upsertAgentHistoryRecord({ record, getConversations, createConversation, updateHistoryList });
    },
    onScopeChange() {
      const conversation = getCurrentConversation();
      if (conversation) conversation.selectedIds = [...editor.selectedIds];
      renderPromptExamples();
    },
    async onProposalHistoryChange(edit, direction) {
      const statusSnapshot = direction === 'undo' ? edit.proposalStatusesBefore : edit.proposalStatusesAfter;
      if (!Array.isArray(statusSnapshot)) return;
      statusSnapshot.forEach(({ item, status }) => { item.status = status; });
      renderConversation();
      persistSavedConversations();
      const appliedProposal = edit.aiProposalItem;
      const conversation = getCurrentConversation();
      if (appliedProposal && conversation?.items.includes(appliedProposal) && getPreviewDialog()?.open) {
        try {
          const proposalPreview = getPreview();
          await proposalPreview.transitionPreview(() => proposalPreview.showPreview(appliedProposal));
          renderConversation();
        } catch (error) { reportPreviewError(error); }
      }
      setStatus(direction === 'undo'
        ? 'AI提案を元に戻し、提案状態も適用前に戻しました。'
        : 'AI提案をやり直しました。');
    }
  });
}
