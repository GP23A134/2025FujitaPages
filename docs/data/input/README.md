# データ更新・移動・追加

クラス分類を更新するときは、編集画面から全件JSONを保存する方法と、AIに変更差分だけを作成させる方法があります。どちらも`class-update.json`としてこのフォルダーに置き、`ClassDataUpdate`を実行してください。`class-update.json`は一時入力としてGit追跡対象外です。反映後は統合データをコミットしてください。AI用の指示は[`classification-prompt.md`](classification-prompt.md)を参照してください。

差分JSONには、必ず[`current-class-data-version.txt`](current-class-data-version.txt)の値を`baseDataHash`として含めます。これはAIへ現在のクラス一覧と一緒に渡してください。差分作成後に元データが更新されていた場合や版情報がない場合、更新プログラムは適用を止め、差分の作り直しを促します。全件JSONによる復元には`baseDataHash`は不要です。

## 更新前に確認すること

```text
1. 追加するクラスの種類（上位・中間）とラベル
2. 移動するクラスまたは中間クラス
3. 移動先の親クラス
4. 既存のインスタンスとクラスの関係は変更しない
5. 親子関係は「子クラスID → 親クラスID」で登録する
6. 循環する親子関係や重複した関係を作らない
```

この確認内容と操作単位は、`edit.html` / `edit.js`の編集画面に対応します。編集画面の保存ボタンから、クラス一覧と親子関係を1つのJSONとしてダウンロードできます。

## 編集操作とJSONの対応

| 編集画面の操作 | JSONの更新内容 |
|---|---|
| 上位・中間クラスを追加 | `classes`に新しいクラスを追加 |
| クラスを中間クラスへ移動 | `relations`のクラスの親を更新 |
| 中間クラスを上位クラスへ移動 | `relations`の中間クラスの親を更新 |
| 親クラスを変更 | 対象の子クラスの親子関係を更新 |
| 未分類へ移動 | クラスを未分類の上位クラスへ関連付け |
| 編集内容を保存 | `class-update.json`を出力 |

クラス自体の追加は編集画面では行いません。クラスやインスタンスを新規取得する場合は、SPARQLの取得結果を更新して`DataIntegrate`を実行します。

## 入力ファイル

入力ファイル名は`class-update.json`です。UTF-8のJSONオブジェクトを指定します。編集画面は従来どおり全件の`classes`と`relations`を出力します。AI用の差分形式では、次の6配列で変更内容だけを指定します。差分は最新の`data/integrated/`へ適用されます。

```json
{
  "classes": [
    { "type": "top", "id": "t_1", "label": "上位クラス" },
    { "type": "middle", "id": "new-m_1", "label": "中間クラス" },
    { "type": "class", "id": "c_00001" }
  ],
  "relations": [
    { "child": "new-m_1", "parent": "t_1" },
    { "child": "c_00001", "parent": "new-m_1" }
  ]
}
```

### AI用の差分形式

変更しない配列も省略せず、空配列として指定します。クラス移動では既存の関係を`removeRelations`で削除し、新しい関係を`addRelations`で追加します。

```json
{
  "baseDataHash": "current-class-data-version.txtの内容",
  "addClasses": [
    { "type": "middle", "id": "new-m_1", "label": "新しい中間クラス" }
  ],
  "renameClasses": [],
  "removeRelations": [
    { "child": "c_00001", "parent": "m_00001" }
  ],
  "addRelations": [
    { "child": "new-m_1", "parent": "t_00001" },
    { "child": "c_00001", "parent": "new-m_1" }
  ],
  "moveChildren": [],
  "removeClasses": []
}
```

`moveChildren`は指定した中間クラスの直接の子を別の親へまとめて移します。`removeClasses`でクラスを削除する場合、そのクラスに関係が残っていてはいけません。差分適用時は、削除する関係が現在のデータに存在すること、追加先のクラスIDが存在すること、循環や所属漏れがないことを確認します。クラスのラベルは既存データから引き継ぎます。

### `classes`

各要素には`type`と`id`を指定します。上位・中間クラスには`label`が必要です。クラスの`label`は省略でき、省略時は既存の[`target-class-data.json`](../integrated/target-class-data.json)から引き継ぎます。

- `type`は`top`（上位）、`middle`（中間）、`class`（対象）です。
- `id`は既存クラスの短縮IDまたは完全URIです。編集画面で追加したクラスには`new-m_1`のような一時IDが付き、実行時に既存IDの最大番号の次へ採番されます。
- 上位・中間クラスの`label`は空にできません。同じ種類・ラベルの重複は登録できません。クラスの`label`は省略でき、既存データから引き継がれます。

### `relations`

各要素には`child`と`parent`を指定します。両方のIDは`classes`に含まれている必要があります。IDは短縮ID、完全URI、一時IDのいずれも指定できます。クラスと中間クラスの親はそれぞれ1つに限ります。中間クラスは別の中間クラスの下に配置できます。

## 更新ルール

- 追加できるのは上位クラスと中間クラスです。
- 差分内の新規クラスIDは一時IDを指定します。更新後、上位クラスは`t_0`（未分類）と`t_1`以降、中間クラスは`m_1`以降の連番に整理され、親子関係のIDも合わせて更新します。削除などで既存IDが変わる場合があるため、AI差分には版情報を必須とします。
- 所属先のないクラス、重複したID・ラベル・親子関係、循環する親子関係があると更新を中止します。
- 「未分類」上位クラスの下に中間クラスを配置した場合、または差分で同名上位クラスがある中間クラスを新設・改名した場合は更新を中止します。既存の同名クラスはそのまま維持します。
- 親子関係は必ず「子 → 親」の向きで記録します。
- インスタンスとクラスの関係は変更しません。
- 画面で未保存の変更がある状態で画面を移動・更新すると、保存確認が表示されます。

## 実行

リポジトリの`docs`ディレクトリから実行します。

```powershell
java -cp "bin;lib/*" ClassDataUpdate
```

実行前に、編集画面またはAIが作成した`class-update.json`をこのフォルダーに置いてください。実行前の全件データを、入力形式にかかわらず`history/class-data-before-update-YYYYMMDD-HHmmss-SSS.json`として自動保存します。成功すると入力JSONも[`history/`](history/)へ`class-update-YYYYMMDD-HHmmss-SSS.json`として移動します。処理に失敗した場合は統合データを更新せず、入力JSONを残します。`ClassDataUpdate`と`DataIntegrate`は成功後に版情報ファイルを更新します。

### 変更前へ戻す

履歴に保存された`class-data-before-update-*.json`から戻したい時点のファイルを選び、`class-update.json`として入力フォルダーへコピーして、上記の`ClassDataUpdate`を再実行します。これは全件JSONなので、差分ではなく選択した時点のクラス分類全体を復元します。

```powershell
Copy-Item -LiteralPath data\input\history\class-data-before-update-YYYYMMDD-HHmmss-SSS.json -Destination data\input\class-update.json
java -cp "bin;lib/*" ClassDataUpdate
```

コンパイル手順やmacOS/Linuxでの実行方法は[`java/README.md`](../../java/README.md)を参照してください。

## 出力

クラスデータのJSONは`data/integrated/`に生成されます。上位・中間クラスの確認用TSVは`data/output/`に生成されます。`instance-class-data.json`は変更しません。
