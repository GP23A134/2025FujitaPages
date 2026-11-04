# 編集画面

`edit.html`で使う編集状態、保持パネル、ツリー操作、保存、画面イベントを担当します。AI機能は`ai/`に分離しています。

## ファイル

| ファイル | 担当 |
| --- | --- |
| `state.js` | 編集データ、選択状態、共通の編集操作 |
| `panels.js` | 保持パネルと選択中クラスの操作 |
| `tree.js` | 編集用ツリー、検索、件数絞り込み |
| `events.js` | 保存、Undo/Redo、画面イベントとAI向けデータAPI |
| `ai/` | AI相談、API通信、応答検証、提案プレビュー |

## 読み込み順

`edit.html`は`shared/tree.js`の後に`state.js`、`panels.js`、`tree.js`、`events.js`を読み込みます。AIは`ai/main.js`をES moduleの入口として読み込みます。詳しくは[AIモジュールのREADME](ai/)を参照してください。
