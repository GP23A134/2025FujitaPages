const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ID_FIELDS = new Set([
  'id', 'classId', 'parentId', 'destinationId', 'classIds', 'instanceId', 'instanceIds',
  'notFoundIds', 'targetIds', 'referenceIds', 'editableIds', 'availableIds'
]);
const isIdField = (key) => ID_FIELDS.has(key) || /(?:Id|Ids)$/.test(key);

export function createDataIdCodec(classes = [], instanceIds = []) {
  const idToAlias = new Map();
  const aliasToId = new Map();
  const counts = { top: 0, middle: 0, class: 0, instance: 0 };
  const prefixes = { top: 't', middle: 'm', class: 'c', instance: 'i' };
  const add = (id, type) => {
    if ((typeof id !== 'string' && typeof id !== 'number') || !String(id) || idToAlias.has(String(id))) return;
    const kind = Object.hasOwn(prefixes, type) ? type : 'class';
    const alias = `${prefixes[kind]}_${++counts[kind]}`;
    idToAlias.set(String(id), alias);
    aliasToId.set(alias, id);
  };

  classes.forEach((item) => add(item?.id, item?.type));
  instanceIds.forEach((item) => add(typeof item === 'string' ? item : item?.id, 'instance'));

  const ids = [...idToAlias.keys()].sort((left, right) => right.length - left.length);
  const aliases = [...aliasToId.keys()].sort((left, right) => right.length - left.length);
  const textIds = ids.filter((id) => !/^\d+$/.test(id));
  const idPattern = textIds.length
    ? new RegExp(`(^|[^A-Za-z0-9_])(${textIds.map(escapeRegExp).join('|')})(?=$|[^A-Za-z0-9_])`, 'g')
    : null;
  const aliasPattern = aliases.length
    ? new RegExp(`(^|[^A-Za-z0-9_])(${aliases.map(escapeRegExp).join('|')})(?=$|[^A-Za-z0-9_])`, 'g')
    : null;

  const replaceText = (value, pattern, mapping) => {
    if (!pattern) return value;
    return value.replace(pattern, (match, boundary, identifier) => `${boundary}${mapping.get(identifier) || identifier}`);
  };
  const replaceValue = (value, mapping, pattern, key = '') => {
    if (typeof value === 'number' && isIdField(key)) return mapping.get(String(value)) || value;
    if (typeof value === 'string') {
      const exact = isIdField(key) ? mapping.get(value) : null;
      return exact || replaceText(value, pattern, mapping);
    }
    if (Array.isArray(value)) return value.map((item) => replaceValue(item, mapping, pattern, key));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [
        mapping.get(name) || name,
        replaceValue(item, mapping, pattern, name)
      ]));
    }
    return value;
  };

  return Object.freeze({
    shorten: (value) => replaceValue(value, idToAlias, idPattern),
    restore: (value) => replaceValue(value, aliasToId, aliasPattern),
    shortenText: (value) => replaceText(String(value), idPattern, idToAlias),
    restoreText: (value) => replaceText(String(value), aliasPattern, aliasToId)
  });
}

export function createIdMaskedClient(client, codec) {
  if (!client?.request || !codec?.shorten || !codec?.restoreText) throw new TypeError('ID短縮通信の依存関係が不足しています。');
  return Object.freeze({
    async request(options) {
      const response = await client.request({ ...options, input: codec.shorten(options.input) });
      if (!response || typeof response !== 'object') return response;
      return {
        ...response,
        ...(typeof response.output_text === 'string' ? { output_text: codec.restoreText(response.output_text) } : {}),
        ...(Array.isArray(response.output) ? { output: response.output.map((item) => ({
          ...item,
          ...(typeof item.arguments === 'string' ? { arguments: codec.restoreText(item.arguments) } : {}),
          ...(Array.isArray(item.content) ? { content: item.content.map((content) => ({
            ...content,
            ...(typeof content.text === 'string' ? { text: codec.restoreText(content.text) } : {})
          })) } : {})
        })) } : {})
      };
    }
  });
}
