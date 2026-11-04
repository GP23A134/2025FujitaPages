# KG Tools

ナレッジグラフの閲覧・クラス分類編集を行うWeb画面と、データ取得・統合・生成を行うJavaツールをまとめたプロジェクトです。

## 画面

- `index.html`：クラス階層、インスタンス、集計結果を閲覧します。
- `edit.html`：クラス階層を編集し、変更案を確認・適用します。AIチャットを使う場合は、画面でOpenAI APIキーを入力します。キーはブラウザー内だけで使います。

## データ更新の流れ

通常のデータ再取得とWeb表示データの更新は、プロジェクトのルート（この`docs`フォルダー）から次の順に実行します。

1. `QueryRun all`で基本クエリと階層クエリを実行し、`data/query-results/`に保存します。
2. `DataIntegrate`で取得結果を統合し、`data/integrated/`と`data/output/`を更新します。
3. `WebDataBuild`で`web/data/generated/`の表示用JavaScriptを更新します。

クラス分類だけを更新するときは、全件JSONまたはAIが作成した差分JSONを`data/input/class-update.json`に置き、`ClassDataUpdate`を実行してから`WebDataBuild`を実行します。入力形式、差分の版確認、履歴からの復元手順は[クラス分類更新のREADME](data/input/README.md)を参照してください。

Javaツールのコンパイル、実行コマンド、クエリモードは[JavaツールのREADME](java/README.md)にまとめています。

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
| `bin/` | Javaのコンパイル出力先 |
| `lib/` | Javaツールの依存ライブラリ |
| `config/` | 開発補助ツールの設定 |
| `data/` | 取得結果、統合データ、更新入力、TSV出力 |

## README一覧

### 実行とデータ

- [Javaツールとクエリ](java/)
- [データフォルダー全体](data/)
- [クラス分類の更新入力](data/input/)
- [SPARQLクエリ結果](data/query-results/)
- [階層クエリ結果](data/query-results/hierarchy/)
- [統合データ](data/integrated/)
- [生成TSV](data/output/)

### Web画面とコード

- [Webアプリ全体](web/README.md)
- [CSS構成と読み込み順](web/css/README.md)
- [Web用データ](web/data/README.md)
- [JavaScript全体](web/js/README.md)
- [共有ツリー処理](web/js/shared/README.md)
- [閲覧画面](web/js/browse/README.md)
- [編集画面](web/js/editor/README.md)
- [AIチャット](web/js/editor/ai/README.md)
