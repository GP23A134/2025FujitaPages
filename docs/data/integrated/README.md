# 統合データ

`DataIntegrate`または`ClassDataUpdate`が生成するJSONを置きます。Webページ用データの元になるため、手動編集せずJavaプログラムから更新してください。

| ファイル | 内容 |
|---|---|
| `instance-data.json` | インスタンスとラベル |
| `instance-class-data.json` | インスタンスとクラスの関係 |
| `class-data.json` | 上位・中間クラスと親子関係 |
| `target-class-data.json` | クラス一覧 |

Web表示用データは`class-data.json`から`WebDataBuild`が生成します。確認用TSVは`DataIntegrate`または`ClassDataUpdate`が[`../output/`](../output/)に出力します。
実行順は[データフォルダー全体のREADME](../README.md)、各Javaプログラムの説明は[JavaツールのREADME](../../java/README.md)を参照してください。
