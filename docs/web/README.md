# Web画面

`index.html`と`edit.html`が使うブラウザー用のファイルを置いています。画面の処理は[JavaScript README](js/)、スタイルは[CSS README](css/)、ブラウザー用データは[Web用データREADME](data/)を参照してください。

## フォルダーとファイル

| パス | 内容 |
|---|---|
| `css/` | 共通、ツリー、編集パネル、閲覧画面のスタイル |
| `js/` | 共有処理、閲覧画面、編集画面、AIチャット |
| `data/generated/` | Javaの`WebDataBuild`が生成するクラス・インスタンスデータ |
| `data/config/` | ブラウザーから読み込むAIモデル設定とシステムプロンプト。秘密情報は置かない |
| `favicon.svg` | 各画面のアイコン |

## 読み込みデータとAI設定

閲覧・編集画面は`data/generated/`のJavaScriptを読み込みます。統合データを更新した後は`WebDataBuild`を実行して表示データを再生成します。手順は[JavaツールREADME](../java/)を参照してください。

`data/config/`の内容はブラウザーに配信されます。APIキーなどの秘密情報は置かず、APIキーは編集画面で利用者が入力してください。AI機能の入力範囲、分割処理、提案のプレビューと適用は[AIチャットREADME](js/editor/ai/)を参照してください。
