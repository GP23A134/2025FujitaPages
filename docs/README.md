# KG Tools

ナレッジグラフのデータ取得、統合、クラス分類の更新、Web表示用データの生成を行うJavaツールです。

## ツール

| プログラム | 内容 |
|---|---|
| `QueryRun` | SPARQLクエリを実行し、結果をJSONで保存します。 |
| `DataIntegrate` | クエリ結果からインスタンス、クラス、所属関係を統合します。 |
| `ClassDataUpdate` | 入力JSONからクラス一覧とクラス間の親子関係を更新します。 |
| `WebDataBuild` | 統合データからWeb表示用のJavaScriptを生成します。 |

## 実行の流れ

通常のデータ更新では、次の順に実行します。

1. `QueryRun` でSPARQLクエリを実行
2. `DataIntegrate` で取得結果を統合
3. `WebDataBuild` でWeb表示用データを生成

クラス分類を更新する場合は、編集画面から保存したJSONを `data/input/` に配置して `ClassDataUpdate` を実行します。詳細は [`data/input/README.md`](data/input/README.md) を参照してください。

## 詳細

- [Javaツールとクエリ](java/README.md)
- [データフォルダの説明](data/README.md)

## 準備

以下のコマンドはリポジトリの `docs` ディレクトリから実行します。JDK（`java` と `javac`）が必要です。依存ライブラリは `lib/` にあります。

### コンパイル

```shell
javac -cp "lib/*" -d bin java/*.java
```

### プログラムの実行

クラスパスの区切り文字は、Windowsではセミコロン（`;`）、macOS/Linuxではコロン（`:`）です。

#### Windows（PowerShell）

```powershell
java -cp "bin;lib/*" QueryRun
java -cp "bin;lib/*" DataIntegrate
java -cp "bin;lib/*" WebDataBuild
```

クラス分類を更新する場合：

```powershell
java -cp "bin;lib/*" ClassDataUpdate
```

#### macOS / Linux

```shell
java -cp "bin:lib/*" QueryRun
java -cp "bin:lib/*" DataIntegrate
java -cp "bin:lib/*" WebDataBuild
```

クラス分類を更新する場合：

```shell
java -cp "bin:lib/*" ClassDataUpdate
```

## データ取得の設定

`QueryRun.java` の `MODE` で実行するクエリを選びます。

- `base`：`java/querys/` のクエリを実行
- `all`：`java/querys/` と `java/upper-class-querys/` のクエリを実行

取得結果は次の場所に、クエリと同じ名前のJSONファイルとして保存されます。

- `data/query-results/base/`：インスタンスと対象クラスの関係
- `data/query-results/hierarchy/`：対象・中間・上位クラスの階層情報

## 出力データ

`DataIntegrate` は `data/integrated/` に次のJSONファイルを生成します。

| ファイル | 内容 |
|---|---|
| `instance-data.json` | インスタンスのIDとラベル |
| `instance-class-data.json` | インスタンスと所属クラスの関係 |
| `class-data.json` | クラス一覧とクラス間の親子関係 |
| `target-class-data.json` | 対象クラスのIDとラベル |

中間・上位クラスの一覧は`class-data.json`から`WebDataBuild`が生成します。確認用TSVは`data/output/`に出力します。

`WebDataBuild` は `data/web/` に `class-data.js` と `instance-data.js` を生成します。
`DataIntegrate` と `ClassDataUpdate` は、上位クラスと中間クラスの一覧TSVを `data/output/` にも生成します。

## ディレクトリ構成

```text
README.md
index.html
edit.html
main.js
edit.js
tree.js
style.css

java/
├── README.md
├── querys/                 # 基本クエリ
├── upper-class-querys/     # 上位クラス取得用クエリ
├── QueryRun.java
├── DataIntegrate.java
├── ClassDataUpdate.java
└── WebDataBuild.java

data/
├── README.md
├── input/                  # クラス更新用JSON
├── query-results/          # SPARQLクエリの取得結果
│   ├── base/               # 基本データ
│   └── hierarchy/          # クラス階層
├── integrated/             # 統合JSON
├── output/                 # 上位・中間クラス一覧TSV
└── web/                    # Web表示用JavaScript
```
