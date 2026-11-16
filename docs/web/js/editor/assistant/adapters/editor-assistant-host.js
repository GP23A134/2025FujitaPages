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
  let agentPreviewProxy = null;
  let agentPreviewOwner = null;

  const clearAgentPreviewProxy = () => {
    if (agentPreviewProxy && agentPreviewOwner) {
      const index = agentPreviewOwner.items.indexOf(agentPreviewProxy);
      if (index >= 0) agentPreviewOwner.items.splice(index, 1);
    }
    agentPreviewProxy = null;
    agentPreviewOwner = null;
  };

  return Object.freeze({
    async previewProposal({ item, onApply, onDismiss }) {
      if (!item?.proposal || typeof onApply !== 'function') throw new TypeError('提案のプレビュー情報が不足しています。');
      const proposalPreview = getPreview();
      if (!proposalPreview) throw new Error('提案プレビューを利用できません。');
      if (agentPreviewProxy) closePreview();
      const proxy = {
        type: 'proposal',
        id: `agent_preview_${Date.now()}`,
        responseGroupId: `agent_preview_${Date.now()}`,
        proposal: {
          id: item.proposal.id,
          title: item.proposal.title,
          summary: item.proposal.summary,
          reason: item.proposal.reason,
          uncertainties: item.proposal.uncertainties || [],
          questions: [],
          conflictGroups: [],
          operations: item.operations
        },
        selectedConflictChoices: {},
        excludedOperationIndexes: new Set(),
        editableIds: item.editableIds,
        availableIds: item.availableIds,
        operationPolicy: item.operationPolicy,
        status: 'pending',
        agentApply: onApply,
        agentDismiss: onDismiss
      };
      agentPreviewProxy = proxy;
      agentPreviewOwner = getCurrentConversation();
      agentPreviewOwner?.items.push(proxy);
      try {
        proxy.baseDataHash = await currentDataHash();
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
