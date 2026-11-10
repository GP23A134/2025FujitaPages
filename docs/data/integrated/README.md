# 統合済みデータ

`DataIntegrate`または`ClassDataUpdate`が生成するJSONを置きます。Webページ用データの元になるため、手動編集せずJavaプログラムから更新してください。クラス分類の更新後は`WebDataBuild`も実行してブラウザー用データを再生成します。

| ファイル | 内容 |
|---|---|
| `instance-data.json` | インスタンスとラベル |
| `instance-class-data.json` | インスタンスとクラスの関係 |
| `class-data.json` | 上位・中間クラスと親子関係 |
| `target-class-data.json` | クラス一覧 |

`DataIntegrate`はSPARQL取得結果から4つのJSONを生成します。`ClassDataUpdate`はクラス一覧と親子関係を更新します。`WebDataBuild`はこれらを読み、`web/data/generated/`を生成します。確認用TSVは`DataIntegrate`または`ClassDataUpdate`が[`../output/`](../output/)に出力します。

Webアプリはクラス・インスタンスデータとクラス階層データの2ファイルも読み込めます。ローカルテスト用の現在データは[`.local-test/data/current-workspace/`](../../.local-test/data/current-workspace/)に置いています。

更新の流れは[データREADME](../)、Javaの実行方法は[JavaツールREADME](../../java/)を参照してください。
