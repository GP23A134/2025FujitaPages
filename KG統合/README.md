# KG統合ツール

RDFクラス階層の付与と、資料一覧の前処理を行うJavaプログラムです。元データは種類ごとに分け、KG統合処理へ渡すデータは`input/integration/`にまとめています。

## フォルダー構成

```text
KG統合/
├─ src/                   Javaソース
│  ├─ AddMiddleAndTopClassesToRdf.java
│  ├─ AddStakeholderTopClassesToRdf.java
│  ├─ ConvertDocumentRelationsToTurtle.java
│  ├─ ConvertClassifiedDocumentsToTurtle.java
│  ├─ RunAllRdfUpdates.java
│  ├─ MergeRdfUpdateOutputs.java
│  └─ WriteRdfUpdateReports.java
├─ prompts/               AI分類などの作業用プロンプト
├─ input/
│  ├─ base-rdf/           ベースN-Quads（Git対象外）
│  ├─ target-classes/     対象クラス更新JSON（Git対象外）
│  ├─ stakeholders/       ステークホルダー更新JSON（Git対象外）
│  ├─ document-list/      地域別 *_relation.tsv（Git対象外）
│  └─ integration/        次のKG統合処理に渡すデータ
│     ├─ stakeholders-with-top.nq
│     ├─ documents-basic.ttl（分類前の下書き）
│     ├─ documents-review.tsv
│     ├─ documents-classified.tsv（分類後に保存）
│     └─ documents.ttl（最終RDF）
├─ output/classes/        対象クラス階層の処理結果
├─ output/REV-KG-DEV_kg-data_2026-11-17_12-55-01_integrated.nq
│                         3処理結果を統合したN-Quads
├─ output/reports/        クラス・資料種別ごとの件数TSV
└─ build/classes/         コンパイル済みクラス（再生成可能）
```

元データの各フォルダーはGit対象外です。前処理で作った`input/integration/`のファイルは、次のKG統合への入力として追跡できます。Javaライブラリは`../docs/lib/`を使います。

## ビルド

`KG統合`フォルダーで実行します。

```powershell
New-Item -ItemType Directory -Force build/classes | Out-Null
javac -encoding UTF-8 -cp "../docs/lib/*" -d build/classes src/AddMiddleAndTopClassesToRdf.java src/AddStakeholderTopClassesToRdf.java src/ConvertDocumentRelationsToTurtle.java src/ConvertClassifiedDocumentsToTurtle.java src/MergeRdfUpdateOutputs.java src/RunAllRdfUpdates.java src/WriteRdfUpdateReports.java
```

## 対象クラスの中間／上位クラス付与

`input/base-rdf/`のベースN-Quadsと`input/target-classes/`のJSONを読み、階層トリプルと対象リソースへの型を追加したN-Quadsを`output/classes/`に出力します。未対応クラス一覧も同じフォルダーに作成します。

```powershell
java -cp "build/classes;../docs/lib/*" AddMiddleAndTopClassesToRdf
```

入力N-Quads、階層JSON、出力N-Quadsは引数で指定できます。

```powershell
java -cp "build/classes;../docs/lib/*" AddMiddleAndTopClassesToRdf "input/base-rdf/REV-KG-DEV_kg-data_2026-08-13_13-18-16.nq" "input/target-classes/class-update-20261117-094934-210.json" "output/classes/result.nq"
```

## ステークホルダー処理

`input/stakeholders/`のJSONにある`st_`親子関係を階層トリプルにし、該当リソースに`st_t_`クラスを付与します。JSONのラベルは使いません。`stakeholderCategory_*`による大分類は対象外です。生成RDFと未対応クラス一覧を`input/integration/`に出力します。

```powershell
java -cp "build/classes;../docs/lib/*" AddStakeholderTopClassesToRdf
```

引数には入力N-Quads、ステークホルダーJSON、出力N-Quadsを順に指定できます。

```powershell
java -cp "build/classes;../docs/lib/*" AddStakeholderTopClassesToRdf "input/base-rdf/REV-KG-DEV_kg-data_2026-08-13_13-18-16.nq" "input/stakeholders/class-update-20261117-104033-219.json" "input/integration/stakeholders-with-top.nq"
```

## 資料一覧の前処理

`input/document-list/`内の`*_relation.tsv`を読み、分類レビュー用TSVと分類前の基本Turtleを`input/integration/`に作ります。この基本Turtleは資料種別の付与前の下書きです。

```powershell
java -cp "build/classes;../docs/lib/*" ConvertDocumentRelationsToTurtle
```

入力フォルダーと出力TSVは引数で変更できます。

```powershell
java -cp "build/classes;../docs/lib/*" ConvertDocumentRelationsToTurtle "input/document-list" "input/integration/documents-review.tsv"
```

資料種別の分類依頼には`prompts/document-type-classification.md`を使い、分類済みTSVを`input/integration/documents-classified.tsv`に保存します。最終RDFでは、この分類済みTSVを使います。

最終変換は分類済みTSVの資料種別と都道府県を使って文書RDFを作ります。`sourceFolderPath`は現時点では出力しません。

```powershell
java -cp "build/classes;../docs/lib/*" ConvertClassifiedDocumentsToTurtle
```

引数には分類済みTSV、出力TTLを順に指定できます。

```powershell
java -cp "build/classes;../docs/lib/*" ConvertClassifiedDocumentsToTurtle "input/integration/documents-classified.tsv" "input/integration/documents.ttl"
```

## 3処理を一括実行

対象クラス、ステークホルダー、分類済み資料の処理をステージング先で実行し、3つが成功した場合に成果物を反映します。統合N-Quadsは、ベースRDFを一度だけ読み込み、対象クラスとステークホルダーの更新、および資料RDFを同じデータセットに適用して`output/REV-KG-DEV_kg-data_2026-11-17_12-55-01_integrated.nq`へ作成します。既存の出力先は新しい処理がすべて成功するまで更新しません。

入力として、ベースRDF、2つの更新JSON、分類済みTSVが必要です。保存元フォルダー情報は現時点では扱いません。

```powershell
java -cp "build/classes;../docs/lib/*" RunAllRdfUpdates
```

統合N-Quadsだけを単独で作成する場合は、次のプログラムを使えます。既定の入力としてベースRDF、2つの更新JSON、`input/integration/documents.ttl`を読み込みます。

```powershell
java -cp "build/classes;../docs/lib/*" MergeRdfUpdateOutputs
```

## 統合RDFのSPARQLクエリ例

対象ファイルは`output/REV-KG-DEV_kg-data_2026-11-17_12-55-01_integrated.nq`です。元データと追加した型は名前付きグラフにあり、資料一覧のトリプルはデフォルトグラフにあります。したがって、元データを検索するときは`GRAPH`を使い、資料一覧を検索するときはデフォルトグラフのパターンを使います。

### 対象クラス（中間・上位クラス）ごとのリソース数

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX cls: <https://kozaki-lab.jp/REFV-KG/class/>

SELECT ?class ?classLabel (COUNT(DISTINCT ?resource) AS ?count)
WHERE {
  GRAPH ?graph {
    ?resource rdf:type ?class .
  }
  GRAPH <https://kozaki-lab.jp/REFV-KG/graph/definitions> {
    ?class rdf:type ?classKind .
    VALUES ?classKind { cls:MiddleClass cls:TopClass }
    OPTIONAL { ?class rdfs:label ?classLabel . }
  }
}
GROUP BY ?class ?classLabel
ORDER BY ?classLabel
```

### ステークホルダーの上位クラスごとのリソース数

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX cls: <https://kozaki-lab.jp/REFV-KG/class/>

SELECT ?topClass ?topClassLabel (COUNT(DISTINCT ?resource) AS ?count)
WHERE {
  GRAPH ?graph {
    ?resource rdf:type ?topClass .
  }
  GRAPH ?hierarchyGraph {
    ?topClass rdf:type cls:StakeholderTopClass ;
              rdfs:label ?topClassLabel .
  }
}
GROUP BY ?topClass ?topClassLabel
ORDER BY ?topClassLabel
```

### 資料一覧と資料種別

資料トリプルはデフォルトグラフにあります。

```sparql
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX cls:  <https://kozaki-lab.jp/REFV-KG/class/>
PREFIX prop: <https://kozaki-lab.jp/REFV-KG/prop/>

SELECT ?document ?name ?prefecture ?documentType
WHERE {
  ?document rdf:type cls:Document ;
            rdfs:label ?name ;
            prop:prefecture ?prefecture ;
            prop:documentType ?documentType .
}
ORDER BY ?document
```

### 原因・影響・対策の主語と中間／上位クラス

```sparql
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX cls:  <https://kozaki-lab.jp/REFV-KG/class/>
PREFIX prop: <https://kozaki-lab.jp/REFV-KG/prop/>

SELECT DISTINCT ?sClass ?sClassLabel ?middleClass ?middleClassLabel
                ?topClass ?topClassLabel ?s ?sLabel ?p
WHERE {
  GRAPH ?g {
    ?s ?p ?o .
    VALUES ?p { prop:cause prop:effect prop:countermeasure }
    OPTIONAL { ?s rdfs:label ?sLabel . }

    OPTIONAL {
      ?s rdf:type ?sClass .
      OPTIONAL { ?sClass rdfs:label ?sClassLabel . }

      OPTIONAL {
        GRAPH ?hierarchyGraph {
          ?sClass rdfs:label ?sClassLabel .
        }
      }

      OPTIONAL {
        GRAPH ?hierarchyGraph {
          ?sClass rdfs:subClassOf+ ?middleClass .
          ?middleClass rdf:type cls:MiddleClass .
          OPTIONAL { ?middleClass rdfs:label ?middleClassLabel . }
        }
      }

      OPTIONAL {
        GRAPH ?hierarchyGraph {
          ?sClass rdfs:subClassOf+ ?topClass .
          ?topClass rdf:type cls:TopClass .
          OPTIONAL { ?topClass rdfs:label ?topClassLabel . }
        }
      }
    }
  }
}
ORDER BY ?sClass ?middleClass ?topClass ?s ?p
```

### 階層トリプル

```sparql
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?child ?childLabel ?parent ?parentLabel
WHERE {
  GRAPH <https://kozaki-lab.jp/REFV-KG/graph/definitions> {
    ?child rdfs:subClassOf ?parent .
    OPTIONAL { ?child rdfs:label ?childLabel . }
    OPTIONAL { ?parent rdfs:label ?parentLabel . }
  }
}
ORDER BY ?childLabel ?parentLabel
```

`graph/definitions`には、中間クラスを`class:MiddleClass`、上位クラスを`class:TopClass`とする`rdf:type`と、階層JSONにある`rdfs:label`を格納します。`graph/stakeholder-hierarchy`には、ステークホルダー上位クラスを`class:StakeholderTopClass`とする`rdf:type`と、JSONにある`rdfs:label`を格納します。`sourceFolderPath`は現在の出力には含まれません。

## RDF更新結果の一覧・件数TSV

件数の集計は一括実行とは別のプログラムです。3つのRDF処理が完了した後に、必要なときに単独で実行します。出力はそれぞれ独立したTSVです。

- `output/reports/target-classes.tsv`: 対象クラスと、そのクラスに属するリソース数
- `output/reports/stakeholders.tsv`: ステークホルダークラスと、そのクラスに属するリソース数
- `output/reports/document-types.tsv`: 資料種別と該当資料数（10種類を含み、0件も表示）

クラス・資料種別ごとに、RDF内の異なるリソースを数えます。同じリソースに同じ型のトリプルが重複していても1件です。クラス名は付けず、クラスIRIを一覧にします。

```powershell
java -cp "build/classes;../docs/lib/*" WriteRdfUpdateReports
```
