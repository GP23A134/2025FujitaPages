# KG Tools

ノートの作業順に沿って、データ作成・分類・Web表示を分離したデータ処理ツールです。

- `QueryDataExporter`：SPARQLクエリを実行し、結果をJSONへ保存
- `InstanceClassIntegrator`：クエリ結果からインスタンスとクラスを統合
- `WebDataGenerator`：統合JSONから`data/web/`へクラスデータとインスタンスデータのJavaScriptを生成
- `ClassRelationUpdater`：inputのTSVからクラス一覧と親子関係を更新
- `ClassLabelConsistencyChecker`：初回取得データと現在のクラスID・ラベル対応を照合

入力データの配置:

```text
data/
├─ query-result/
│  ├─ base-data/
│  └─ upper-class-data/
└─ integrated-data/
```

コンパイル例（初回は Maven が必要なライブラリを取得します）:

```text
mvn -f java/pom.xml compile
```

実行例:

```text
mvn -f java/pom.xml exec:java "-Dexec.mainClass=InstanceClassIntegrator"
mvn -f java/pom.xml exec:java "-Dexec.mainClass=WebDataGenerator"
```

## クラスID・ラベル対応の検査

初回取得データ（`data/query-result/`）と現在の統合データ（`data/integrated-data/class-data.json`）を照合します。
欠落、ラベル変更、現在のみ存在するID、重複を検出し、差異がある場合は終了コード1になります。

```text
mvn -f java/pom.xml exec:java "-Dexec.mainClass=ClassLabelConsistencyChecker"
```

別の入力を指定する場合は、初回データのファイルまたはフォルダー、現在データの順に引数を渡します。

`QueryDataExporter.java` 上部の `MODE` を変更して、初期データ取得モードを指定します。

```text
mvn -f java/pom.xml exec:java "-Dexec.mainClass=QueryDataExporter"
```

`MODE = "base"` は `querys/` のみ、`MODE = "all"` は `querys/` と `upper-class-querys/` を実行します。

各クエリは同名のJSONとして、`data/query-result/base-data/` または `data/query-result/upper-class-data/` に保存します。出力形式はJSONに統一しています。コマンドは `docs` ディレクトリから実行してください。

`base-data` はインスタンスと対象クラスの固定関係です。`upper-class-data` は対象クラス・中間クラス・上位クラスの階層情報です。分類変更ではインスタンスと対象クラスの関係を変更しません。

## インスタンスとクラスの統合

クエリ結果から、主語・目的語を区別せず、インスタンスごとの所属クラスを統合します。

```text
mvn -f java/pom.xml exec:java "-Dexec.mainClass=InstanceClassIntegrator"
```

出力先は次の2ファイルです。

- `data/integrated-data/instance-data.json`：インスタンス本体（ID・ラベル）
- `data/integrated-data/instance-class-data.json`：インスタンスとクラスの関係（インスタンスID・クラスID）
- `data/integrated-data/class-data.json`：クラス一覧とクラス間の親子関係
- `data/integrated-data/middle-class-list.json`：中間クラス一覧
- `data/integrated-data/top-class-list.json`：上位クラス一覧

Web表示用の`data/web/class-data.js`（クラスデータ）と`data/web/instance-data.js`（インスタンスデータ）を生成する場合は、次を実行します。

```text
mvn -f java/pom.xml exec:java "-Dexec.mainClass=WebDataGenerator"
```
