// 変更案一覧を描画し、操作はプレビュー画面へ委譲します。
export const createProposalView = ({ messages, getProposalPreview, renderConversation, reportPreviewError,
  renderOperationCountBadges, excerpt }) => {
  const displayState = (item) => {
    if (item.status === 'applied') return { key: 'applied', label: '適用済み' };
    if (item.status === 'dismissed' || item.status === 'alternative-rejected') return { key: 'dismissed', label: '見送り' };
    if (item.status === 'awaiting-answers') return { key: 'unjudged', label: '回答待ち' };
    if (item.status === 'stale') return { key: 'unjudged', label: '再確認が必要' };
    if (item.status === 'superseded') return { key: 'unjudged', label: '更新待ち' };
    if (item.status === 'invalid') return { key: 'unjudged', label: '適用不可' };
    return { key: 'unjudged', label: '未判断' };
  };

  const renderQueue = (items, host = messages) => {
    const proposalGroup = items[0];
    const queue = document.createElement('section');
    queue.className = 'ai-proposal-queue ai-proposal-queue-compact';
    const heading = document.createElement('div');
    heading.className = 'ai-proposal-queue-heading';
    const disclosure = document.createElement('details');
    disclosure.className = 'ai-proposal-queue-disclosure';
    disclosure.open = proposalGroup.proposalListOpen === true;
    disclosure.addEventListener('toggle', () => { proposalGroup.proposalListOpen = disclosure.open; });
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.className = 'ai-proposal-queue-title';
    title.textContent = `変更案 ${items.length}件`;
    const statusCounts = items.reduce((counts, item) => {
      counts[displayState(item).key] += 1;
      return counts;
    }, { unjudged: 0, applied: 0, dismissed: 0 });
    const statusBadges = document.createElement('span');
    statusBadges.className = 'ai-proposal-queue-status-counts';
    [
      ['unjudged', '未判断', statusCounts.unjudged],
      ['applied', '適用済み', statusCounts.applied],
      ['dismissed', '見送り', statusCounts.dismissed]
    ].forEach(([key, label, count]) => {
      const badge = document.createElement('span');
      badge.className = `ai-proposal-status-badge is-${key}`;
      badge.textContent = `${label} ${count}件`;
      statusBadges.append(badge);
    });
    summary.append(title, statusBadges);

    const content = document.createElement('div');
    content.className = 'ai-proposal-queue-content';
    const proposalList = document.createElement('div');
    proposalList.className = 'ai-proposal-list';
    const sortedItems = [...items].sort((a, b) =>
      Number(displayState(b).key === 'unjudged') - Number(displayState(a).key === 'unjudged'));
    const listEntries = [];
    const alternativeGroups = new Map();
    sortedItems.forEach((item) => {
      if (!item.alternativeGroupId) {
        listEntries.push({ type: 'proposal', item });
        return;
      }
      let group = alternativeGroups.get(item.alternativeGroupId);
      if (!group) {
        group = { type: 'alternative-group', id: item.alternativeGroupId, items: [] };
        alternativeGroups.set(item.alternativeGroupId, group);
        listEntries.push(group);
      }
      group.items.push(item);
    });

    const renderListItem = (item) => {
      const proposal = item.proposal;
      const state = displayState(item);
      const row = document.createElement('article');
      row.className = `ai-proposal-list-item is-${state.key}`;
      const main = document.createElement('div');
      main.className = 'ai-proposal-list-main';
      const meta = document.createElement('div');
      meta.className = 'ai-proposal-list-meta';
      // 保存済みの古い相談では、適用不可の過去提案を内容確認用に表示します。
      if (item.sourceType === 'global_plan' || item.sourceType === 'chunk') {
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'ai-proposal-source';
        sourceLabel.textContent = item.sourceType === 'global_plan' ? '全体プラン' : '範囲別の個別案';
        meta.append(sourceLabel);
      }
      const proposalTitle = document.createElement('strong');
      proposalTitle.className = 'ai-proposal-list-title';
      proposalTitle.textContent = proposal.title || `提案${items.indexOf(item) + 1}`;
      meta.append(proposalTitle);
      meta.append(...renderOperationCountBadges(proposal.operations || [], 'ai-preview-type-badge', { hideZero: true }));
      const description = document.createElement('p');
      description.className = 'ai-proposal-list-description';
      description.textContent = excerpt(proposal.summary || proposal.title, 240);
      main.append(meta, description);
      const actions = document.createElement('div');
      actions.className = 'ai-proposal-list-actions';
      const stateBadge = document.createElement('span');
      stateBadge.className = `ai-proposal-status-badge is-${state.key}`;
      stateBadge.textContent = state.label;
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'ai-proposal-preview';
      preview.textContent = 'プレビュー';
      preview.disabled = ['awaiting-answers', 'superseded', 'alternative-rejected', 'invalid'].includes(item.status);
      preview.addEventListener('click', () => {
        void getProposalPreview().showPreview(item, false).then(() => renderConversation()).catch(reportPreviewError);
      });
      actions.append(stateBadge, preview);
      row.append(main, actions);
      return row;
    };

    listEntries.forEach((entry) => {
      if (entry.type === 'proposal') {
        proposalList.append(renderListItem(entry.item));
        return;
      }
      const group = document.createElement('section');
      group.className = 'ai-proposal-alternative-group';
      const header = document.createElement('div');
      header.className = 'ai-proposal-alternative-group-heading';
      const groupTitle = document.createElement('strong');
      const isGlobalPlanGroup = entry.id === 'global_plan_alternatives';
      const groupNumber = entry.id.replace(/^split_alternative_/, '');
      const hasGlobalPlans = entry.items.some((item) => item.sourceType === 'global_plan');
      const hasIndividualPlans = entry.items.some((item) => item.sourceType !== 'global_plan');
      groupTitle.textContent = isGlobalPlanGroup
        ? hasGlobalPlans && hasIndividualPlans ? '全体プランと個別案の比較' : '全体プランの比較'
        : `代替案グループ${groupNumber}`;
      const groupNote = document.createElement('span');
      groupNote.textContent = `${entry.items.length}案・いずれか1案を選択`;
      groupNote.title = '1案を適用すると、同じグループの他の案は適用できません。';
      header.append(groupTitle, groupNote);
      const alternatives = document.createElement('div');
      alternatives.className = 'ai-proposal-alternative-group-items';
      entry.items.forEach((item) => alternatives.append(renderListItem(item)));
      group.append(header, alternatives);
      proposalList.append(group);
    });
    content.append(proposalList);
    disclosure.append(summary, content);

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'ai-proposal-preview ai-proposal-queue-preview';
    preview.textContent = 'プレビュー';
    const isPreviewable = (item) => !['awaiting-answers', 'superseded', 'alternative-rejected', 'invalid'].includes(item.status);
    preview.disabled = !items.some(isPreviewable);
    preview.addEventListener('click', () => {
      const start = items.find(isPreviewable);
      if (start) void getProposalPreview().showPreview(start).then(() => renderConversation()).catch(reportPreviewError);
    });
    heading.append(disclosure, preview);
    const updateHeaderPreviewVisibility = () => { preview.hidden = disclosure.open; };
    disclosure.addEventListener('toggle', updateHeaderPreviewVisibility);
    updateHeaderPreviewVisibility();
    queue.append(heading);
    host.append(queue);
  };

  return { renderQueue };
};
