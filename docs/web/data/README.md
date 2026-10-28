# Web用データ

ブラウザーが使うデータは`web/`以下にまとめています。

| フォルダ | 内容 | 管理方法 |
|---|---|---|
| `generated/` | `class-data.js`、`instance-data.js`。閲覧・編集ページが読む公開データ | `WebDataBuild`で生成。直接編集しない |
| `config/` | AIモデル設定とシステムプロンプト | 内容を確認して手動更新。ブラウザーから読めるため秘密情報を置かない |

`WebDataBuild`は`data/integrated/`を読み、`web/data/generated/`へ出力します。出力ファイルがない場合はフォルダーを作成します。

faviconは`web/favicon.svg`に置いています。APIキーは編集画面で利用者が入力し、ページを閉じるまでメモリ内に保持します。