# 新AI処理モジュール

このフォルダーは新しい対話型AI処理の実装先です。旧チャットは `../legacy/` にあり、内部構成やデータ形式を直接共有しません。

## 構成と責務

- `features/planning/plan-contract.js`: 固定計画形式と入力検査
- `features/planning/plan-input.js`: 依頼文・クラス件数・解決済み再編起点の概要を使って計画入力を作成
- `features/planning/planning-service.js`: 計画API呼び出しと計画結果検査
- `features/planning/plan-schema.js`: APIへ渡す厳密な計画JSONスキーマ
- `prompts/plan-system-prompt.js`: 計画段階の固定指示
- `prompts/agent-system-prompt.js`: 調査・変更案作成エージェントの固定指示
- 読み取り専用の評価指示は `prompts/agent-system-prompt.js` と、分割確認の統合指示 `features/data-retrieval/chunked-read-only-review.js` に定義
- `adapters/openai-client.js`: APIキーを保存せずResponses APIへ送信
- `features/data-retrieval/settings.js`: 取得件数と詳細ID数に共通する開発者設定
- `features/progress/progress-view.js`: チャット欄の工程吹き出し、範囲・状態・経過時間の表示
- `features/scope-approval/scope-approval-view.js`: チャットの概要から要求範囲を一括で許可・拒否し、詳細を読み取り表示
- `features/planning/question-view.js`: 全体質問・提案ごとの確認に最大4件の回答候補と自由入力を表示
- `features/validation/settings.js`: 提案修正の再試行設定
- `adapters/editor-bridge.js`: 既存エディターから件数と内部データ版だけを読む境界
- `../integration/agent-legacy-bridge.js` と `agent-legacy-bridge-registry.js`: 新方式の提案プレビュー・履歴を旧方式の画面機能へ接続する移行用アダプターと登録契約
- `../integration/chat-events.js`: 新旧画面をまたぐ進捗・利用量イベント名の共有契約
- `entry.js`: 編集画面での新モジュール初期化
- `application/conversation-state.js`: 依頼単位のワークフロー状態・遷移・継続カウンター
- `application/task-state.js`: 目的・完了条件・対象範囲・データ版・確認事項・未完了事項・行動履歴を保持する共通タスク状態と、構造モードに沿った行動提案の基本検査
- `settings/registry.js`: 機能別設定の集約と値検証
- `settings/register-defaults.js`: 各機能の設定登録
- `conversations/settings.js`: 履歴保存の開発者設定
- `conversations/history-service.js`: チャット履歴と継続作業メモのタブ内保存、任意の24時間保存、期限切れと削除
- `conversations/conversation-memory.js`: 会話の継続文脈、再編段階の処理状況、対象範囲、データ版、累積利用量の整形・上限管理
- `application/workflow.js`: 計画・取得・提案確認・承認後適用の状態進行
- `agent-runtime/`: ツール登録、許可範囲、API応答ループ、処理上限
- `features/proposals/`: 提案形式、原子的な検証、競合選択とプレビュー
- `features/proposals/proposal-preview.js`: 新方式の提案を表示・選択・適用するプレビュー。画面ロジックは新方式側へ移行済みだが、変更操作の合成と競合選択判定は移行期間中 `legacy/proposal-engine.js` を共有
- 移動案の一括判定は処理前に対象件数と最低取得・応答回数を確認し、1回100クラスずつ扱う。JSON応答の再試行でも失敗する場合は対象を半分に分けて再処理する
- 移動判定バッチは1件ずつ順番に処理し、各バッチの結果を確認してから次へ進む
- 一時的な408・レート制限・サーバー過負荷は、`Retry-After`または上限付きバックオフで最大3回再試行する。利用枠・請求上限の429は再試行しない
- アプリ内のAI応答回数上限に達した場合は、チャット上で利用者に追加20回の許可を求める。許可されれば実行中のワークフローをその位置から続行し、拒否された場合は停止する。OpenAI側の利用枠・レート制限はこの許可では変更できない
- アプリ内の累積入力トークン上限に達した場合は、チャット上で利用者に追加トークン枠の許可を求める。許可されれば実行中のワークフローをその位置から続行し、拒否された場合は停止前に完了した確認結果を未確認範囲とともに表示する。追加枠は1回50,000トークン以上で、必要量が大きい場合は不足分まで増やす。OpenAI側の利用枠・レート制限はこの許可では変更できない
- 追加参照を拒否された場合は、範囲外データを取得せず、許可済み範囲で続ける。親情報なしで確認できる依頼は続行し、階層情報が必須の移動案は安全に作成できない理由を結果に示す
- 同じクラスの最大3つの妥当な移動先はクラス単位の代替案グループとして表示し、他クラスの独立した移動案と混ぜない
- OpenAIの利用実績を既存AIチャットの料金集計へ渡し、従来の利用量表示に合算
- `features/data-retrieval/`: 索引、直下クラス、詳細、インスタンスの読み取り専用取得
- `settings/`: 機能別の設定登録・検証・画面表示

編集画面に「新方式で相談」を追加し、既存のツリー操作・変更履歴APIへアダプター経由で接続しています。AIに書き込みツールは公開せず、検証済み提案のプレビューで利用者が適用した場合だけ編集APIを呼びます。

新旧方式の段階的な分離として、互換アダプター、アダプター登録、進捗・利用量イベント契約を `chat/integration/` に置いています。チャットモジュールは登録契約を使い、従来スクリプト向けには `window.editorChatIntegration` の小さな互換APIを公開します。評価用プロンプトもチャット実装フォルダーから共有設定へ移しています。

会話履歴を同じチャット内の後続依頼へ引き継ぎます。クラスの事実は引き継がず、毎回現在のデータから取得します。分類再編の依頼では、段階ごとの要求・選択範囲・処理結果・データ版・累積AI利用量を継続作業メモへ保存し、全体案の依頼時に対象ルートを再確認して既存提案形式でまとめます。会話履歴はタブ内に保存し、設定により別タブへ24時間保存できます。APIキーは保存しません。実行上限の一部は運用測定前の調整可能な候補値です。

## 実装順

1. `node --test tests/assistant-*.test.cjs` で新モジュールを検証
2. `node --test tests/*.test.cjs` で既存編集機能との回帰を検証
3. ブラウザー上で新規依頼・範囲許可・質問の候補選択／自由入力・提案プレビュー・適用を手動確認
4. 実データと費用に基づき暫定の処理上限を調整
