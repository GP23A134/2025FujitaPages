// 適用済みの追加クラスを、保留中の提案が参照する一時IDへ反映します。
export function reconcilePendingProposalAdditions({ appliedProposal, conversation, responseHandler }) {
  const snapshot = appliedProposal?.appliedPreviewSnapshot;
  if (!snapshot) return;
  const beforeIds = new Set(snapshot.before.classes.map((item) => item.id));
  const addedClasses = snapshot.after.classes.filter((item) => !beforeIds.has(item.id));
  if (!addedClasses.length) return;
  const afterParentByChild = new Map(snapshot.after.relations.map(({ child, parent }) => [child, parent]));
  conversation.items.filter((item) => item.type === 'proposal' && item !== appliedProposal
    && !['applied', 'dismissed'].includes(item.status)).forEach((item) => {
    const aliases = new Map();
    const additions = item.proposal.operations.filter((operation) => operation.type === 'addClass' && operation.temporaryId);
    let aliasesChanged = true;
    while (aliasesChanged) {
      aliasesChanged = false;
      additions.forEach((operation) => {
        if (aliases.has(operation.temporaryId)) return;
        const parentId = operation.parentId || '';
        const resolvedParentId = aliases.get(parentId) || parentId;
        if (parentId && resolvedParentId === parentId
          && additions.some((candidate) => candidate.temporaryId === parentId)) return;
        const label = String(operation.label || '').trim();
        const matches = addedClasses.filter((candidate) => candidate.type === operation.classType
          && String(candidate.label || '').trim() === label
          && (afterParentByChild.get(candidate.id) || '') === resolvedParentId);
        if (matches.length === 1) {
          aliases.set(operation.temporaryId, matches[0].id);
          aliasesChanged = true;
        }
      });
    }
    if (!aliases.size) return;
    const originalOperations = item.proposal.operations.map((operation) => ({ ...operation }));
    const originallyExcluded = new Set(item.excludedOperationIndexes || []);
    const resolveAppliedIds = (operation) => {
      const normalized = { ...operation };
      ['parentId', 'classId', 'destinationId', 'from', 'to'].forEach((key) => {
        if (aliases.has(normalized[key])) normalized[key] = aliases.get(normalized[key]);
      });
      return normalized;
    };
    item.proposal.operations = item.proposal.operations.map(resolveAppliedIds);
    item.availableIds = [...new Set([...(item.availableIds || []), ...aliases.values()])];
    responseHandler.normalizeDuplicateClassOperations({ proposals: [item.proposal] }, item.availableIds);
    const normalizedIndexes = new Map();
    item.proposal.operations.forEach((operation, index) => {
      const key = JSON.stringify(operation);
      if (!normalizedIndexes.has(key)) normalizedIndexes.set(key, []);
      normalizedIndexes.get(key).push(index);
    });
    const excludedIndexes = new Set();
    originalOperations.forEach((operation, index) => {
      if (operation.type === 'addClass' && aliases.has(operation.temporaryId)) return;
      const key = JSON.stringify(resolveAppliedIds(operation));
      const matches = normalizedIndexes.get(key);
      if (!matches?.length) return;
      const normalizedIndex = matches.shift();
      if (originallyExcluded.has(index)) excludedIndexes.add(normalizedIndex);
    });
    item.excludedOperationIndexes = excludedIndexes;
  });
}
