# Javaツール

`java/`には、SPARQLデータの取得、取得結果の統合、クラス分類の更新、Web表示データの生成に使うJavaソースとクエリを置いています。プロジェクト全体の概要は[ルートREADME](../)を参照してください。コンパイル結果はローカルの`bin/`に出力されます。

## プログラム

| クラス | 役割 |
|---|---|
| `QueryRun` | SPARQLクエリを実行し、JSONを`data/query-results/`へ保存します。 |
| `DataIntegrate` | クエリ結果を統合し、`data/integrated/`と確認用TSVを生成します。 |
| `ClassDataUpdate` | `data/input/class-update.json`を検証・適用し、クラス一覧と親子関係を更新します。更新前データと処理済み入力を履歴へ保存します。 |
| `ClassDataVersion` | クラスデータのSHA-256を計算し、差分入力が最新データを基に作られたか検証します。 |
| `WebDataBuild` | 統合データから`web/data/generated/`のJavaScriptを生成します。 |

## クエリ

- `querys/`：インスタンス、ラベル、クラス関係の基本クエリ。
- `upper-class-querys/`：クラスから上位・中間クラスまでの階層クエリ。

`QueryRun`の引数で実行範囲を選びます。`base`は基本クエリ、`all`は基本クエリと階層クエリの両方です。引数を省略するとソース内の`MODE`設定を使います。全データを更新するときは`all`を指定してください。

## コンパイル

以下はプロジェクトのルート（`docs`フォルダー）から実行します。JDKと`lib/`の依存ライブラリが必要です。

```shell
javac -cp "lib/*" -d bin java/*.java
```

## 実行

Windowsではクラスパスの区切りにセミコロンを使います。

```powershell
java -cp "bin;lib/*" QueryRun all
java -cp "bin;lib/*" DataIntegrate
java -cp "bin;lib/*" WebDataBuild
```

クラス分類の更新では、`data/input/class-update.json`を用意して次を実行します。

```powershell
java -cp "bin;lib/*" ClassDataUpdate
java -cp "bin;lib/*" WebDataBuild
```

macOS/Linuxではクラスパスの区切りをコロンにします。

```shell
java -cp "bin:lib/*" QueryRun all
java -cp "bin:lib/*" DataIntegrate
java -cp "bin:lib/*" ClassDataUpdate
java -cp "bin:lib/*" WebDataBuild
```

JSON形式、差分更新ルール、履歴からの復元は[データ更新README](../data/input/)を参照してください。
