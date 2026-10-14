# 分類変更入力ファイル

このフォルダーのTSVを編集してから、`ClassRelationUpdater`を実行します。

## class-list.tsv

UTF-8、タブ区切りで、ヘッダーは次のとおりです。

```text
種類	ID	ラベル
```

種類は `top`、`middle`、`class`（または日本語の上位クラス・中間クラス・対象クラス）を指定します。IDを空欄にすると、既存IDの最大番号の次に自動付与します。

## class-relation.tsv

UTF-8、タブ区切りで、ヘッダーは次のとおりです。

```text
子クラスID	親クラスID
```

IDは `c_00001` のような短縮形でも、完全URIでも指定できます。ファイルに記載した関係が、統合後のクラス間関係になります。

## 実行

```text
mvn -f java/pom.xml exec:java "-Dexec.mainClass=ClassRelationUpdater"
```

出力先は `data/integrated-data/` の `class-data.json`、`middle-class-list.json`、`top-class-list.json` です。`instance-class-data.json` は変更しません。
