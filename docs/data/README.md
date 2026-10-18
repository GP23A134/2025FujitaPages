# データフォルダ

サイト表示用データと、Javaツールが処理する入力・出力データを置いています。

## フォルダ

| フォルダ | 内容 |
|---|---|
| `input/` | クラス分類を更新するためのTSVや入力手順。詳細は[`input/README.md`](input/README.md)を参照してください。 |
| `query-result/` | `QueryRun`がSPARQLクエリから取得したJSON。`base-data/`にはインスタンスと対象クラスの関係、`upper-class-data/`にはクラス階層情報を保存します。 |
| `integrated-data/` | `DataIntegrate`と`ClassDataUpdate`が生成する統合JSON。 |
| `web/` | `WebDataBuild`が生成するJavaScript。Webページが読み込むため、サイトの更新時に必要です。 |

## データ処理の流れ

1. `java/QueryRun.java`がクエリ結果を`query-result/`に保存します。
2. `java/DataIntegrate.java`が取得結果を統合し、`integrated-data/`に保存します。
3. クラス分類を変更する場合は、`input/`のTSVを使って`java/ClassDataUpdate.java`を実行します。
4. `java/WebDataBuild.java`が統合JSONから`web/`のJavaScriptを生成します。

各プログラムの実行方法は[`java/README.md`](../java/README.md)を参照してください。
