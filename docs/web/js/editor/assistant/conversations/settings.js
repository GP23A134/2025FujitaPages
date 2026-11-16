// 履歴のタブ間保存は任意機能で、初期状態ではタブを閉じると破棄します。
export const CONVERSATION_SETTINGS = Object.freeze([
  {
    key: 'conversations.persistAcrossTabs',
    type: 'boolean',
    defaultValue: false,
    label: 'タブを閉じた後も履歴を保存',
    description: '有効時は会話履歴を最終更新から24時間保持します。処理の再開状態やAPIキーは保存しません。'
  }
]);
