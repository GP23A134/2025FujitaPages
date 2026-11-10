# データ

SPARQLの取得結果、統合データ、クラス分類の更新入力、確認用TSVを置いています。Webページ用データは[`../web/data/`](../web/data/)にあります。

## フォルダ

| フォルダ | 内容 |
|---|---|
| `input/` | クラス分類を更新するJSONと入力手順。更新履歴のJSONはローカル保管のみで、Gitには含めません。詳細は[`input/`](input/)を参照してください。 |
| `query-results/` | `QueryRun`がSPARQLクエリから取得したJSON。`base/`にはインスタンスとクラスの関係、`hierarchy/`にはクラス階層情報を保存します。詳細は[`query-results/`](query-results/)を参照してください。 |
| `integrated/` | `DataIntegrate`と`ClassDataUpdate`が生成する統合JSON。ファイル一覧は[`integrated/`](integrated/)を参照してください。 |
| `output/` | 上位クラスと中間クラスの一覧TSV。`DataIntegrate`または`ClassDataUpdate`が生成します。TSVはGit管理対象です。形式は[`output/`](output/)を参照してください。 |

## Git管理

`data/input/class-update.json`は更新時に使う一時入力で、成功すると`input/history/`へ移動します。実行前スナップショットと処理済み入力を含む`input/history/*.json`、`query-results/**/*.tmp`は`.gitignore`で除外します。取得元JSON、統合JSON、TSV、Web生成データは更新後に差分を確認してGit管理します。Javaの`.class`ファイルは`bin/`に生成され、Git管理対象外です。

## 更新の流れ

1. `java/QueryRun.java`がクエリ結果を`query-results/`に保存します。
2. `java/DataIntegrate.java`が取得結果を統合し、`integrated/`に保存します。
3. クラス分類を変更する場合は、`input/class-update.json`に編集画面の全件JSONまたはAI作成の差分JSONを置いて`java/ClassDataUpdate.java`を実行します。実行前の全件データは入力形式にかかわらず`input/history/`に自動保存されます。
4. `DataIntegrate`または`ClassDataUpdate`が上位・中間クラス一覧TSVを`output/`に生成します。
5. `java/WebDataBuild.java`が統合JSONから`../web/data/generated/`のJavaScriptを生成します。

Javaツールのコンパイルと実行方法は[`java/README.md`](../java/)を参照してください。分類JSONの形式と適用ルールは[`input/README.md`](input/)を参照してください。
