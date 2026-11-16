const formatUsd = (value) => `約 $${Number(value || 0).toFixed(6)} USD`;

export function createUsageView(container, accounting, getPricingConfig) {
  if (!container || !accounting) return Object.freeze({ render() {} });
  function render() {
    const totals = accounting.summary(getPricingConfig());
    const config = getPricingConfig();
    const section = document.createElement('section');
    section.className = 'assistant-usage-card';
    const heading = document.createElement('h3');
    heading.textContent = '新システムの利用量';
    section.append(heading);
    for (const [label, summary] of [['今回の依頼', totals.task], ['このページの累計', totals.session]]) {
      const row = document.createElement('p');
      row.className = 'assistant-usage-row';
      const title = document.createElement('strong');
      title.textContent = label;
      const amount = document.createElement('span');
      amount.textContent = summary.known ? formatUsd(summary.costUsd) : '料金不明';
      const detail = document.createElement('small');
      detail.textContent = `${summary.requests}回・入力 ${summary.inputTokens.toLocaleString()} / 出力 ${summary.outputTokens.toLocaleString()} tokens`;
      row.append(title, amount, detail);
      section.append(row);
    }
    const note = document.createElement('small');
    const date = config?.pricingAsOf ? `単価確認日: ${config.pricingAsOf}。` : '';
    note.textContent = `${date}モデル設定の単価による概算です。実際の請求額とは異なる場合があります。単価未確認のモデルやAPI使用量が返らない場合は料金不明と表示します。`;
    section.append(note);
    container.replaceChildren(section);
  }
  render();
  return Object.freeze({ render });
}
