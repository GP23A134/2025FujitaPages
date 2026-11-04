# Webアプリ

`index.html`と`edit.html`が読み込むブラウザー用のファイルを置いています。画面とJavaScriptの構成は[JavaScript README](js/README.md)、スタイルの役割と読み込み順は[CSS README](css/README.md)、データの配置と生成方法は[Web用データREADME](data/README.md)を参照してください。

## フォルダーとファイル

| パス | 内容 |
|---|---|
| `css/` | 共通、ツリー、編集パネル、閲覧画面のスタイル |
| `js/` | 共有処理、閲覧画面、編集画面、AIチャット |
| `data/generated/` | Javaの`WebDataBuild`が生成するクラス・インスタンスデータ |
| `data/config/` | ブラウザーから読み込むAIモデル設定とシステムプロンプト |
| `favicon.svg` | 各画面のアイコン |

## 画面データ

閲覧・編集画面は`data/generated/`のJavaScriptをHTMLから読み込みます。統合データを更新した後は、プロジェクトルートから`WebDataBuild`を実行して表示データを再生成します。手順は[JavaツールREADME](../java/README.md)を参照してください。

`data/config/`の内容はブラウザーに配信されます。APIキーなどの秘密情報は置かず、APIキーは編集画面で利用者が入力してください。
