# KG Tools

既存のJavaプログラムとは独立した、機能別のデータ処理ツールです。

- `HierarchyDataReader`：`data/classes`内の階層ディレクトリを統合
- `HierarchyJsonGenerator`：統合TSVから階層JSONとブラウザー用JavaScriptを生成
- `ClassIdAssigner`：クラス一覧とフォルダーへIDを付与

入力データの配置:

```text
data/
├─ classes.tsv             # 対象クラス本体
├─ 上位クラス一覧.tsv       # 上位クラス一覧
├─ 中間クラス一覧.tsv       # 中間クラス一覧
└─ classes/                # 階層と対象クラスの所属
   └─ top_上位クラス/
      ├─ direct.tsv
      └─ middle_中間クラス/direct.tsv
```

コンパイル例:

```text
javac -encoding UTF-8 -d out java/*.java
```

実行例:

```text
java -cp out HierarchyDataReader
java -cp out HierarchyJsonGenerator
```
