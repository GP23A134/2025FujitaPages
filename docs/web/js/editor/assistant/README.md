# 新AI処理モジュール

このフォルダーは新しい対話型AI処理の実装先です。既存の `../ai/` は動作と画面連携の参考として扱い、内部構成やデータ形式をそのまま前提にしません。

## 構成と責務

- `features/planning/plan-contract.js`: 固定計画形式と入力検査
- `features/planning/plan-input.js`: 依頼文とクラス件数だけの計画入力を作成
- `features/planning/planning-service.js`: 計画API呼び出しと計画結果検査
- `features/planning/plan-schema.js`: APIへ渡す厳密な計画JSONスキーマ
- `features/planning/system-prompt.js`: 計画段階の固定指示
- `adapters/openai-client.js`: APIキーを保存せずResponses APIへ送信
- `features/data-retrieval/settings.js`: 取得件数と詳細ID数に共通する開発者設定
- `features/progress/progress-view.js`: チャット欄の工程吹き出し、範囲・状態・経過時間の表示
- `features/scope-approval/scope-approval-view.js`: チャットの概要から要求範囲を一括で許可・拒否し、詳細を読み取り表示
- `features/planning/question-view.js`: 全体質問・提案ごとの確認に最大4件の回答候補と自由入力を表示
- `features/validation/settings.js`: 提案修正の再試行設定
- `adapters/editor-bridge.js`: 既存エディターから件数と内部データ版だけを読む境界
- `entry.js`: 編集画面での新モジュール初期化
- `application/conversation-state.js`: 依頼単位のワークフロー状態・遷移・継続カウンター
- `settings/registry.js`: 機能別設定の集約と値検証
- `settings/register-defaults.js`: 各機能の設定登録
- `conversations/settings.js`: 会話保存の開発者設定
- `conversations/session-service.js`: タブ内保存、任意の24時間保存、期限切れと削除
- `application/workflow.js`: 計画・取得・提案確認・承認後適用の状態進行
- `agent-runtime/`: ツール登録、許可範囲、API応答ループ、処理上限
- `features/proposals/`: 提案形式、原子的な検証、競合選択とプレビュー
- OpenAIの利用実績を既存AIチャットの料金集計へ渡し、従来の利用量表示に合算
- `features/data-retrieval/`: 索引、直下クラス、詳細、インスタンスの読み取り専用取得
- `settings/`: 機能別の設定登録・検証・画面表示

編集画面に「新方式で相談」を追加し、既存のツリー操作・変更履歴APIへアダプター経由で接続しています。AIに書き込みツールは公開せず、検証済み提案のプレビューで利用者が適用した場合だけ編集APIを呼びます。

計画のID・名称漏えい、許可境界、再現可能なインスタンスサンプル、トークンと呼び出し上限、タブ再開、任意の24時間保存をテストで確認します。実行上限の一部は運用測定前の調整可能な候補値です。

## 実装順

1. `node --test tests/assistant-*.test.cjs` で新モジュールを検証
2. `node --test tests/*.test.cjs` で既存編集機能との回帰を検証
3. ブラウザー上で新規依頼・範囲許可・質問の候補選択／自由入力・提案プレビュー・適用を手動確認
4. 実データと費用に基づき暫定の処理上限を調整
