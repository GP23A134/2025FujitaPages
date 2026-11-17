import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

/** 既存の3つのRDF処理を順番に実行するランチャーです。 */
public final class RunAllRdfUpdates {
    private static final Path BASE_RDF = Paths.get(
            "input/base-rdf/REV-KG-DEV_kg-data_2026-08-13_13-18-16.nq");
    private static final Path TARGET_CLASSES = Paths.get(
            "input/target-classes/class-update-20261117-094934-210.json");
    private static final Path STAKEHOLDERS = Paths.get(
            "input/stakeholders/class-update-20261117-104033-219.json");
    private static final Path CLASSIFIED_DOCUMENTS = Paths.get(
            "input/integration/documents-classified.tsv");
    private static final Path DOCUMENT_LIST_DIRECTORY = Paths.get("input/document-list");

    private RunAllRdfUpdates() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 0) {
            throw new IllegalArgumentException("使い方: java RunAllRdfUpdates（引数なし）");
        }
        checkRequiredFile(BASE_RDF);
        checkRequiredFile(TARGET_CLASSES);
        checkRequiredFile(STAKEHOLDERS);
        checkRequiredFile(CLASSIFIED_DOCUMENTS);
        checkFileLists();

        System.out.println("[1/3] 対象クラスの階層付与を実行します。");
        AddMiddleAndTopClassesToRdf.main(new String[0]);

        System.out.println("[2/3] ステークホルダーの上位クラス付与を実行します。");
        AddStakeholderTopClassesToRdf.main(new String[0]);

        System.out.println("[3/3] 分類済み資料のTurtle変換を実行します。");
        ConvertClassifiedDocumentsToTurtle.main(new String[0]);

        System.out.println("3つの処理がすべて完了しました。");
    }

    private static void checkRequiredFile(Path path) throws IOException {
        if (!Files.isRegularFile(path)) throw new IOException("必要な入力ファイルがありません: " + path);
    }

    private static void checkFileLists() throws IOException {
        if (!Files.isDirectory(DOCUMENT_LIST_DIRECTORY)) {
            throw new IOException("資料一覧フォルダーがありません: " + DOCUMENT_LIST_DIRECTORY);
        }
        try (var files = Files.list(DOCUMENT_LIST_DIRECTORY)) {
            List<Path> fileLists = files.filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().toLowerCase().endsWith("-files.tsv"))
                    .toList();
            if (fileLists.isEmpty()) {
                throw new IOException("保存元フォルダー情報がありません。*-files.tsvを配置してください: "
                        + DOCUMENT_LIST_DIRECTORY);
            }
        }
    }
}
