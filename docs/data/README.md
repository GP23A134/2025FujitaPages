# データフォルダ

サイト表示用データと、Javaツールが処理する入力・出力データを置いています。

## フォルダ

| フォルダ | 内容 |
|---|---|
| `input/` | クラス分類を更新するJSONと入力手順。詳細は[`input/README.md`](input/README.md)を参照してください。 |
| `query-results/` | `QueryRun`がSPARQLクエリから取得したJSON。`base/`にはインスタンスと対象クラスの関係、`hierarchy/`にはクラス階層情報を保存します。詳細は[`query-results/README.md`](query-results/README.md)を参照してください。 |
| `integrated/` | `DataIntegrate`と`ClassDataUpdate`が生成する統合JSON。ファイル一覧は[`integrated/README.md`](integrated/README.md)を参照してください。 |
| `output/` | 上位クラスと中間クラスの一覧TSV。`DataIntegrate`または`ClassDataUpdate`が生成します。形式は[`output/README.md`](output/README.md)を参照してください。 |
| `web/` | `WebDataBuild`が生成するJavaScript。Webページが読み込むため、サイトの更新時に必要です。詳細は[`web/README.md`](web/README.md)を参照してください。 |

## データ処理の流れ

1. `java/QueryRun.java`がクエリ結果を`query-results/`に保存します。
2. `java/DataIntegrate.java`が取得結果を統合し、`integrated/`に保存します。
3. クラス分類を変更する場合は、`input/class-update.json`に編集画面の全件JSONまたはAI作成の差分JSONを置いて`java/ClassDataUpdate.java`を実行します。実行前の全件データは入力形式にかかわらず`input/history/`に自動保存されます。
4. `DataIntegrate`または`ClassDataUpdate`が上位・中間クラス一覧TSVを`output/`に生成します。
5. `java/WebDataBuild.java`が統合JSONから`web/`のJavaScriptを生成します。

各プログラムの実行方法は[`java/README.md`](../java/README.md)を参照してください。
