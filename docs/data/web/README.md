# Web表示用データ・設定・静的ファイル

Web関連ファイルは、生成物・設定・静的ファイルの用途ごとに分けています。

| フォルダ | 内容 | 管理方法 |
|---|---|---|
| `generated/` | `class-data.js`、`instance-data.js`。閲覧・編集ページが読み込む公開データ | `WebDataBuild`で生成。直接編集しない |
| `config/` | `ai-models.json`、`ai-system-prompt.md`。AI接続のモデル候補と指示文 | 内容を確認して手動更新 |
| `assets/` | `favicon.svg`などWebページの静的ファイル | 手動で管理 |

`WebDataBuild`は`data/integrated/`を読み、`generated/`へ出力します。出力ファイルがない場合は親フォルダーを作成します。

`config/`のファイルはブラウザーから取得するため、Web公開時には閲覧可能です。秘密情報やAPIキーは保存しないでください。APIキーは編集画面で利用者が入力し、ページを閉じるまでメモリ内に保持します。
