// クラスIDを依頼ごとに短い別名へ置き換え、応答に含まれる別名を元のIDへ戻します。
// 別名は現在のクラス一覧から作るため、別の依頼やデータ版へ持ち越してはいけません。
export const createClassIdCodec = (classes) => {
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const counts = { top: 0, middle: 0, class: 0 };
    const prefixes = { top: 't', middle: 'm', class: 'c' };
    const idToAlias = new Map();
    const aliasToId = new Map();
    const uriPrefixes = new Set();
    const plainIds = [];

    classes.forEach((item) => {
      const type = Object.hasOwn(prefixes, item.type) ? item.type : 'class';
      const alias = `${prefixes[type]}_${++counts[type]}`;
      idToAlias.set(item.id, alias);
      aliasToId.set(alias, item.id);
      if (/^https?:\/\//i.test(item.id)) {
        uriPrefixes.add(item.id.slice(0, item.id.lastIndexOf('/') + 1));
      } else {
        plainIds.push(item.id);
      }
    });

    const uriPatterns = [...uriPrefixes]
      .sort((left, right) => right.length - left.length)
      .map((prefix) => new RegExp(`${escapeRegExp(prefix)}[A-Za-z0-9._~-]+`, 'g'));
    const plainIdPattern = plainIds.length
      ? new RegExp(`(^|[^A-Za-z0-9_])(${plainIds.sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})(?=$|[^A-Za-z0-9_])`, 'g')
      : null;

    const shortenString = (value) => {
      let result = value;
      uriPatterns.forEach((pattern) => {
        result = result.replace(pattern, (id) => idToAlias.get(id) || id);
      });
      if (plainIdPattern) {
        result = result.replace(plainIdPattern, (match, boundary, id) => `${boundary}${idToAlias.get(id) || id}`);
      }
      return result;
    };
    const shortenValue = (value) => idToAlias.get(value) || value;
    const replace = (value) => {
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [shortenValue(key), replace(item)]));
      }
      return typeof value === 'string' ? shortenString(shortenValue(value)) : value;
    };

    return {
      alias: shortenValue,
      restore: (value) => aliasToId.get(value) || value,
      shortenText: (serialized) => {
        try { return JSON.stringify(replace(JSON.parse(serialized))); }
        catch { return shortenString(serialized); }
      }
    };
};
