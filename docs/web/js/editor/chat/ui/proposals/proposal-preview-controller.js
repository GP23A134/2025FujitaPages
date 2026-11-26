// プレビューダイアログの操作を登録し、変更の適用自体は呼び出し元へ委譲します。
export function createProposalPreviewController({
  previewDialog,
  proposalPreview,
  getBridge,
  renderConversation,
  setStatus,
  reportPreviewError,
  applyLegacyProposal
}) {
  const closePreview = () => {
    getBridge()?.clearPreviewProxy();
    previewDialog.close();
    proposalPreview.clear();
  };

  previewDialog.addEventListener('close', () => {
    getBridge()?.clearPreviewProxy();
    proposalPreview.clear();
    document.getElementById('ai-preview-impact').classList.remove('is-loading');
    document.getElementById('ai-apply-proposal').disabled = true;
  });
  previewDialog.addEventListener('click', (event) => {
    if (event.target !== previewDialog) return;
    const rect = previewDialog.getBoundingClientRect();
    const clickedOutside = event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
    if (clickedOutside) closePreview();
  });
  document.getElementById('ai-preview-close').addEventListener('click', closePreview);
  document.getElementById('ai-dismiss-proposal').addEventListener('click', async () => {
    const dismissed = proposalPreview.dismissCurrentProposal();
    if (!dismissed) return;
    if (typeof dismissed.currentProposal?.agentDismiss === 'function') {
      dismissed.currentProposal.agentDismiss();
      if (dismissed.nextProposal) {
        setStatus('変更案を見送りました。次の案を確認しています。編集データは変更していません。');
        try { await proposalPreview.transitionPreview(() => proposalPreview.showPreview(dismissed.nextProposal)); }
        catch (error) { reportPreviewError(error); }
      } else {
        closePreview();
        setStatus('変更案を見送りました。編集データは変更していません。');
      }
      return;
    }
    renderConversation();
    if (dismissed.nextProposal) {
      setStatus('変更案を見送りました。次の案を確認しています。編集データは変更していません。');
      try {
        await proposalPreview.transitionPreview(() => proposalPreview.showPreview(dismissed.nextProposal));
        renderConversation();
      } catch (error) { reportPreviewError(error); }
    } else {
      closePreview();
      setStatus('変更案を見送りました。編集データは変更していません。');
    }
  });

  const previewArrowToggle = document.getElementById('ai-preview-arrow-toggle');
  previewArrowToggle.addEventListener('click', () => {
    const visible = previewArrowToggle.getAttribute('aria-checked') !== 'true';
    previewArrowToggle.setAttribute('aria-checked', String(visible));
    previewArrowToggle.querySelector('.ai-preview-arrow-toggle-state').textContent = visible ? 'ON' : 'OFF';
    const arrowSvg = document.getElementById('ai-preview-direction');
    const addOrigin = document.getElementById('ai-preview-add-origin');
    arrowSvg.hidden = !visible;
    arrowSvg.setAttribute('aria-hidden', String(!visible));
    if (!visible && addOrigin) addOrigin.hidden = true;
    if (visible) requestAnimationFrame(() => proposalPreview.renderPreviewArrows(proposalPreview.plan?.arrows || []));
    else arrowSvg.replaceChildren();
  });
  window.addEventListener('resize', () => {
    if (!document.getElementById('ai-preview-direction').hidden) proposalPreview.renderPreviewArrows(proposalPreview.plan?.arrows || []);
  });
  document.getElementById('ai-preview-previous').addEventListener('click', () => proposalPreview.navigatePreview(-1));
  document.getElementById('ai-preview-next').addEventListener('click', () => proposalPreview.navigatePreview(1));
  previewDialog.addEventListener('keydown', (event) => {
    if (!previewDialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft' && !document.getElementById('ai-preview-previous').disabled) {
      event.preventDefault();
      proposalPreview.navigatePreview(-1);
    } else if (event.key === 'ArrowRight' && !document.getElementById('ai-preview-next').disabled) {
      event.preventDefault();
      proposalPreview.navigatePreview(1);
    }
  });
  document.getElementById('ai-preview-conflict-previous-group').addEventListener('click', () => proposalPreview.navigateConflictGroup(-1));
  document.getElementById('ai-preview-conflict-next-group').addEventListener('click', () => proposalPreview.navigateConflictGroup(1));
  document.getElementById('ai-preview-conflict-previous-choice').addEventListener('click', () => proposalPreview.navigateConflictChoice(-1));
  document.getElementById('ai-preview-conflict-next-choice').addEventListener('click', () => proposalPreview.navigateConflictChoice(1));
  document.getElementById('ai-preview-conflict-select-choice').addEventListener('click', () => proposalPreview.selectConflictChoice());
  document.getElementById('ai-preview-page-previous').addEventListener('click', () => proposalPreview.navigatePreviewPage(-1));
  document.getElementById('ai-preview-page-next').addEventListener('click', () => proposalPreview.navigatePreviewPage(1));
  document.getElementById('ai-preview-group-include').addEventListener('click', () => {
    const item = proposalPreview.plan?.proposalItem;
    const group = proposalPreview.currentGroup;
    if (!item || !group) return;
    proposalPreview.updatePreviewSelection(item, () => group.indexes.forEach((index) => item.excludedOperationIndexes.delete(index)));
  });
  document.getElementById('ai-preview-group-exclude').addEventListener('click', () => {
    const item = proposalPreview.plan?.proposalItem;
    const group = proposalPreview.currentGroup;
    if (!item || !group) return;
    proposalPreview.updatePreviewSelection(item, () => group.indexes.forEach((index) => item.excludedOperationIndexes.add(index)));
  });
  document.getElementById('ai-preview-select-all').addEventListener('click', () => {
    const item = proposalPreview.plan?.proposalItem;
    if (!item) return;
    proposalPreview.updatePreviewSelection(item, () => item.excludedOperationIndexes.clear());
  });
  document.getElementById('ai-preview-exclude-all').addEventListener('click', () => {
    const item = proposalPreview.plan?.proposalItem;
    if (!item) return;
    proposalPreview.updatePreviewSelection(item, () => {
      item.excludedOperationIndexes = new Set(item.proposal.operations.map((_, index) => index));
    });
  });
  document.getElementById('ai-apply-proposal').addEventListener('click', async () => {
    if (typeof proposalPreview.plan?.proposalItem?.agentApply !== 'function') {
      await applyLegacyProposal();
      return;
    }
    const applyButton = document.getElementById('ai-apply-proposal');
    applyButton.disabled = true;
    try {
      const result = await proposalPreview.applyCurrentProposal();
      if (result?.external) {
        if (result.nextProposal) {
          setStatus('提案を適用しました。次の未判断案を確認しています。');
          await proposalPreview.transitionPreview(() => proposalPreview.showPreview(result.nextProposal));
        } else {
          closePreview();
          setStatus('提案を適用しました。必要なら最新状態について改めて依頼してください。');
        }
      }
    } catch (error) {
      reportPreviewError(error);
      if (previewDialog.open) applyButton.disabled = false;
    }
  });

  return Object.freeze({ closePreview });
}
