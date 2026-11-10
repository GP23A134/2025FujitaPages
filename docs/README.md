# KG Tools

ナレッジグラフの閲覧・クラス分類編集を行うWeb画面と、データの取得・統合・Web表示用データ生成を行うJavaツールのプロジェクトです。

## 画面

- `index.html`：クラス階層、インスタンス、集計結果を閲覧します。
- `edit.html`：クラス階層を編集し、保持中の対象を移動できます。AIチャットは変更案を提示し、利用者がプレビューから適用します。利用時は画面でOpenAI APIキーを入力します。

## データ更新

通常の再取得は`QueryRun` → `DataIntegrate` → `WebDataBuild`の順に行います。クラス分類だけを更新する場合は、更新JSONを`data/input/`に置いて`ClassDataUpdate`を実行し、その後`WebDataBuild`を実行します。

コンパイルと実行コマンドは[JavaツールREADME](java/)に、JSON形式・更新ルール・履歴からの復元は[クラス分類更新README](data/input/)にまとめています。

## プロジェクト構成

| パス | 内容 |
|---|---|
| `index.html`, `edit.html` | 閲覧画面と編集画面 |
| `web/css/` | 共通・画面別のスタイル |
| `web/js/shared/` | 閲覧・編集画面で使う共通処理 |
| `web/js/browse/` | 閲覧画面の処理 |
| `web/js/editor/` | 編集画面とAIチャットの処理 |
| `web/data/config/` | AIモデル設定とシステムプロンプト |
| `web/data/generated/` | Javaツールが生成するWeb表示データ |
| `java/` | データ取得、統合、更新、Webデータ生成のJavaソースとSPARQLクエリ |
| `bin/` | Javaのローカルコンパイル出力先。`.gitignore`でGit管理から除外 |
| `lib/` | Javaツールの依存ライブラリ |
| `config/` | 開発補助ツールの設定 |
| `data/` | 取得結果、統合データ、更新入力、TSV出力 |

`data/input/history/`には分類更新前のスナップショットと適用済み入力をローカル保存します。履歴JSONと一時入力は`.gitignore`で除外されます。取得結果、統合JSON、生成TSV、Web表示データは更新後に差分を確認して管理します。

## README一覧

### 実行とデータ

- [Javaツールとクエリ](java/)
- [データフォルダー全体](data/)
- [クラス分類の更新入力](data/input/)
- [クラス分類のローカル履歴](data/input/history/)
- [SPARQLクエリ結果](data/query-results/)
- [階層クエリ結果](data/query-results/hierarchy/)
- [統合データ](data/integrated/)
- [生成TSV](data/output/)

### Web画面とコード

- [Webアプリ全体](web/)
- [CSS構成と読み込み順](web/css/)
- [Web用データ](web/data/)
- [JavaScript全体](web/js/)
- [共有ツリー処理](web/js/shared/)
- [閲覧画面](web/js/browse/)
- [編集画面](web/js/editor/)
- [AIチャット](web/js/editor/ai/)
