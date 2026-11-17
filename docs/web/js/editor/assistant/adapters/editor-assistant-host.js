export function createEditorAssistantHost({
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
    async previewProposal({ item, proposals = [item], onApply, onDismiss }) {
      if (!item?.proposal || typeof onApply !== 'function') throw new TypeError('提案のプレビュー情報が不足しています。');
      const proposalPreview = getPreview();
      if (!proposalPreview) throw new Error('提案プレビューを利用できません。');
      if (agentPreviewProxies.length) closePreview();
      agentPreviewOwner = getCurrentConversation();
      if (!agentPreviewOwner?.items) throw new Error('提案の相談を開けません。');
      const responseGroupId = `agent_preview_${Date.now()}`;
      const sourceItems = [...new Set([item, ...proposals])].filter((candidate) => candidate?.proposal && Array.isArray(candidate.operations));
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
        agentApply: (operationIndexes) => onApply(sourceItem, operationIndexes),
        agentDismiss: () => onDismiss?.(sourceItem)
      }));
      const proxy = agentPreviewProxies[sourceItems.indexOf(item)] || agentPreviewProxies[0];
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
      if (!record || typeof record.id !== 'string' || !Array.isArray(record.items)) return false;
      const conversations = getConversations();
      let conversation = conversations.find((item) => item.id === record.id);
      if (!conversation) {
        conversation = {
          ...createConversation(Array.isArray(record.selectedIds) ? record.selectedIds : []),
          id: record.id,
          saved: false,
          assistantMode: 'agent'
        };
      }
      conversation.assistantMode = 'agent';
      conversation.title = typeof record.title === 'string' && record.title.trim() ? record.title : '新しい相談';
      conversation.titleIsCustom = false;
      conversation.updatedAt = Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now();
      conversation.selectedIds = Array.isArray(record.selectedIds) ? [...record.selectedIds] : [];
      conversation.items = record.items.filter((item) => item?.type === 'message'
        && ['user', 'assistant'].includes(item.role) && typeof item.text === 'string')
        .map(({ type, role, text }) => ({ type, role, text }));
      conversation.status = '';
      conversation.workflowStatus = '';
      conversation.splitMemory = null;
      if (conversation === getCurrentConversation()) renderConversation();
      updateHistoryList();
      return true;
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
