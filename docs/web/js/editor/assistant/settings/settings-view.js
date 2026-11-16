const FEATURE_LABELS = Object.freeze({
  dataRetrieval: 'データ取得',
  validation: '変更案の検証',
  conversations: '会話の保存',
  chatSystem: 'チャットシステム',
  agentRuntime: 'AI処理上限',
  instances: 'インスタンス情報',
  proposals: '変更操作'
});

export function createSettingsView(container, registry, { getValue, onChange }) {
  const groups = new Map();
  for (const definition of registry.list()) {
    if (!groups.has(definition.feature)) {
      const section = document.createElement('section');
      section.className = 'assistant-settings-group';
      const heading = document.createElement('h4');
      heading.textContent = FEATURE_LABELS[definition.feature] || definition.feature;
      section.append(heading);
      container.append(section);
      groups.set(definition.feature, section);
    }
    const section = groups.get(definition.feature);
    const field = document.createElement('div');
    field.className = 'assistant-setting-field';
    const label = document.createElement('label');
    const input = document.createElement(definition.type === 'boolean' ? 'input' : 'input');
    input.id = `assistant-setting-${definition.key.replaceAll('.', '-')}`;
    input.dataset.assistantSetting = definition.key;
    if (definition.type === 'boolean') {
      input.type = 'checkbox';
      input.checked = Boolean(getValue(definition.key));
      label.className = 'assistant-setting-toggle';
      label.append(input, document.createTextNode(definition.label));
    } else if (definition.type === 'number') {
      input.type = 'number';
      input.min = definition.min;
      input.max = definition.max;
      input.step = definition.step || 1;
      input.value = getValue(definition.key);
      label.htmlFor = input.id;
      label.textContent = definition.label;
      field.append(label, input);
    } else if (definition.type === 'enum') {
      const select = document.createElement('select');
      select.id = input.id;
      select.dataset.assistantSetting = definition.key;
      for (const value of definition.values || []) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = definition.labels?.[value] || value;
        select.append(option);
      }
      select.value = getValue(definition.key);
      label.htmlFor = select.id;
      label.textContent = definition.label;
      field.append(label, select);
      input.remove();
      section.append(field);
      select.addEventListener('change', () => onChange(definition.key, select.value));
      if (definition.description) {
        const note = document.createElement('small');
        note.textContent = definition.description;
        field.append(note);
      }
      continue;
    }
    if (definition.type === 'boolean') field.append(label);
    if (definition.description || definition.provisional) {
      const note = document.createElement('small');
      note.textContent = [definition.description, definition.provisional ? '初期値は運用候補です。処理量と費用を確認して調整してください。' : ''].filter(Boolean).join(' ');
      field.append(note);
    }
    section.append(field);
    input.addEventListener('change', () => onChange(definition.key, definition.type === 'boolean' ? input.checked : Number(input.value)));
  }
  return Object.freeze({
    refresh(values) {
      container.querySelectorAll('[data-assistant-setting]').forEach((input) => {
        const definition = registry.list().find((item) => item.key === input.dataset.assistantSetting);
        if (!definition) return;
        if (definition.type === 'boolean') input.checked = Boolean(values[definition.key]);
        else input.value = values[definition.key];
      });
    }
  });
}
