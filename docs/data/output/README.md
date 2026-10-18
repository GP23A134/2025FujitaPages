# 生成TSV

このフォルダには、統合データから生成したクラス一覧を置きます。ファイルは手動編集せず、`DataIntegrate`または`ClassDataUpdate`を実行して更新してください。

| ファイル | 内容 |
|---|---|
| `middle-class-list.tsv` | 中間クラスのIDとラベル |
| `top-class-list.tsv` | 上位クラスのIDとラベル |

どちらもUTF-8、タブ区切りで、ヘッダーは`ID`と`ラベル`です。IDは`m_`または`t_`から始まる短縮IDで、ID順に並びます。
