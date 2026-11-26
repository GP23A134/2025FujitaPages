# AIチャットの構成

## フォルダー

- `agent/`: 計画、データ取得、AI処理、検証、会話継続を行う現行の実行系です。
- `ui/`: 共有チャット画面、会話履歴表示、提案プレビュー操作など、利用者向け画面を構成します。
- `domain/`: AI実行方式や画面に依存しない提案操作・履歴再調整の処理を置きます。
- `integration/`: 現行画面とAI実行系をつなぐブリッジ、イベント、履歴変換を置きます。
- `compat/legacy-ai/`: 現在は読み込まれない旧AI送信コードを保管します。現行機能から参照しません。

## 実行時の流れ

`edit.html` は `ui/chat-host.js` で共有画面を初期化し、`agent/entry.js` で現行AIを初期化します。フォーム送信は `agent/entry.js` が受け取り、`agent/application/workflow.js` が計画・取得・AI処理・検証を進めます。AIの提案プレビューは `agent/features/proposals/` が準備し、画面との接続を `integration/` 経由で行います。

```text
edit.html
  ├─ ui/chat-host.js ── 会話画面・履歴・プレビューUI
  │      └─ integration/chat-ui-bridge.js
  └─ agent/entry.js ── 送信・履歴・進捗
         └─ agent/application/workflow.js ── 計画・取得・AI処理・検証
```

## 主な配置

- `ui/conversation/`: 会話履歴の保存互換、メッセージと履歴一覧の描画
- `ui/proposals/`: 提案一覧、プレビュー操作、操作表示名、適用中の進捗表示
- `domain/proposals/proposal-engine.js`: 新旧AIが共有する提案操作の合成・検査
- `domain/proposals/proposal-history-reconciler.js`: 適用後に保留提案内の一時IDを実データIDへ対応づけ
- `integration/agent-history-adapter.js`: AI側の履歴を画面側の表示形式へ変換
- `compat/legacy-ai/`: 旧送信処理。現行コードから読み込まれません

## 残っている移行上の結合

`ui/chat-host.js` は履歴とプレビューを管理し、`integration/chat-ui-bridge.js` がAI側へ公開します。画面側の会話データ形式には旧実装由来の形が残っています。次段階では履歴形式を統一し、ブリッジのデータ契約を整理します。

旧AI送信コードは隔離済みですが、互換保管のためファイルを残しています。依存を持つ `domain/proposals/proposal-engine.js` は現行AIも利用している共有ロジックです。
