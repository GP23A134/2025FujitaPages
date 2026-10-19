# 更新履歴

`ClassDataUpdate`が処理した更新入力と、実行直前の全件スナップショットを保管します。更新入力は`class-update-YYYYMMDD-HHmmss-SSS.json`、復元用スナップショットは`class-data-before-update-YYYYMMDD-HHmmss-SSS.json`というファイル名です。スナップショットは全件JSONなので、`data/input/README.md`の手順で再適用すると変更前の状態へ戻せます。履歴データ自体は編集しません。
