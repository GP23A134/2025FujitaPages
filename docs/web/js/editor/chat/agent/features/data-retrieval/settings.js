// 取得上限は索引・直下取得・詳細ID取得で共通にします。
export const DATA_RETRIEVAL_SETTINGS = Object.freeze([
  {
    key: 'dataRetrieval.pageAndIdLimit',
    type: 'number',
    defaultValue: 100,
    min: 1,
    max: 1000,
    step: 1,
    label: '1回の取得上限',
    description: 'ページ取得件数と、詳細取得で一度に指定できるID数に共通で適用します。'
  }
]);
