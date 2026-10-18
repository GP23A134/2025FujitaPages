# Javaツール

ナレッジグラフの取得データを処理するJavaプログラムと、実行用のSPARQLクエリを置いています。全体の処理の流れは[プロジェクトREADME](../README.md)を参照してください。

## プログラム

| ファイル | 役割 |
|---|---|
| `QueryRun.java` | SPARQLクエリを実行し、結果をJSONで保存します。 |
| `DataIntegrate.java` | クエリ結果からインスタンスやクラスのデータを統合します。 |
| `ClassDataUpdate.java` | `data/input/` のTSVからクラス一覧と親子関係を更新します。 |
| `WebDataBuild.java` | 統合データからWeb表示用のJavaScriptを生成します。 |

## クエリ

- `querys/`：インスタンスと対象クラスに関する基本データを取得します。
- `upper-class-querys/`：対象クラスから上位クラスまでの階層情報を取得します。

`QueryRun.java` の `MODE` を `base` にすると基本クエリのみ、`all` にすると両方のクエリを実行します。

## コンパイルと実行

コマンドはリポジトリの`docs`ディレクトリから実行します。JDKと、リポジトリ内の`lib/`にある依存ライブラリが必要です。

```shell
javac -cp "lib/*" -d bin java/*.java
```

Windowsではクラスパスをセミコロンで区切ります。

```powershell
java -cp "bin;lib/*" QueryRun
java -cp "bin;lib/*" DataIntegrate
java -cp "bin;lib/*" ClassDataUpdate
java -cp "bin;lib/*" WebDataBuild
```

macOS/Linuxではコロンで区切ります。

```shell
java -cp "bin:lib/*" QueryRun
java -cp "bin:lib/*" DataIntegrate
java -cp "bin:lib/*" ClassDataUpdate
java -cp "bin:lib/*" WebDataBuild
```

`ClassDataUpdate`が読むTSVの形式や更新ルールは[`data/input/README.md`](../data/input/README.md)に記載しています。
