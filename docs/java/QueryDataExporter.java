import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.List;

import org.apache.jena.query.QueryExecution;
import org.apache.jena.query.QueryFactory;
import org.apache.jena.query.ResultSetFormatter;
import org.apache.jena.sparql.exec.http.QueryExecutionHTTP;
import org.apache.jena.sparql.exec.http.QuerySendMode;

/**
 * SPARQL クエリファイルを実行し、結果を JSON ファイルとして出力するツールです。
 */
public class QueryDataExporter {
    private static final String ENDPOINT_URL = "http://localhost:3030/CCO4KG_2026-10-05/sparql";
    private static final String TIMEOUT_MILLISECONDS = "60000";
    private static final String USER_AGENT = "Example-Agent/1.0 (https://www.example.com; xxx@example.com)";

    private static final Path BASE_QUERY_DIRECTORY = Paths.get("java/querys");
    private static final Path BASE_OUTPUT_DIRECTORY = Paths.get("data/query-result/base-data");
    private static final Path UPPER_CLASS_QUERY_DIRECTORY = Paths.get("java/upper-class-querys");
    private static final Path UPPER_CLASS_OUTPUT_DIRECTORY = Paths.get("data/query-result/upper-class-data");

    /** base: 基本クエリのみ / all: 上位クラス用クエリも実行 */
    private static final String MODE = "base";

    /**
     * {@code base} は基本クエリのみ、{@code all} は上位クラスクエリも実行します。
     */
    public static void main(String[] args) {
        ExecutionMode mode;
        try {
            String modeName = args.length == 0 ? MODE : args[0];
            mode = ExecutionMode.fromName(modeName);
        } catch (IllegalArgumentException e) {
            System.err.println(e.getMessage());
            return;
        }

        runQueries(BASE_QUERY_DIRECTORY, BASE_OUTPUT_DIRECTORY);
        if (mode.includesUpperClassQueries()) {
            runQueries(UPPER_CLASS_QUERY_DIRECTORY, UPPER_CLASS_OUTPUT_DIRECTORY);
        }
    }

    /**
     * 指定フォルダー内の .rq ファイルを名前順に実行します。
     */
    private static void runQueries(Path queryDirectory, Path outputDirectory) {
        validateQueryDirectory(queryDirectory);
        List<Path> queryFiles = findQueryFiles(queryDirectory);
        if (queryFiles.isEmpty()) {
            throw new IllegalStateException("クエリファイルがありません: " + queryDirectory);
        }

        createOutputDirectory(outputDirectory);
        deleteGeneratedResults(outputDirectory);
        for (Path queryFile : queryFiles) {
            Path outputFile = outputDirectory.resolve(toJsonFileName(queryFile));
            runQuery(queryFile, outputFile);
        }
    }

    private static void deleteGeneratedResults(Path outputDirectory) {
        try (var files = Files.list(outputDirectory)) {
            for (Path file : files.filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().endsWith(".json"))
                    .toList()) {
                Files.delete(file);
            }
        } catch (IOException e) {
            throw new IllegalStateException("古いクエリ結果を削除できません: " + outputDirectory, e);
        }
    }

    private static void validateQueryDirectory(Path queryDirectory) {
        if (!Files.isDirectory(queryDirectory)) {
            throw new IllegalStateException("クエリフォルダーが見つかりません: " + queryDirectory);
        }
    }

    private static List<Path> findQueryFiles(Path queryDirectory) {
        try (var files = Files.list(queryDirectory)) {
            return files
                    .filter(Files::isRegularFile)
                    .filter(QueryDataExporter::isSparqlQueryFile)
                    .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                    .toList();
        } catch (IOException e) {
            throw new IllegalStateException("クエリフォルダーを読み込めません: " + queryDirectory, e);
        }
    }

    private static boolean isSparqlQueryFile(Path path) {
        return path.getFileName().toString().endsWith(".rq");
    }

    private static void createOutputDirectory(Path outputDirectory) {
        try {
            Files.createDirectories(outputDirectory);
        } catch (IOException e) {
            throw new IllegalStateException("出力フォルダーを作成できません: " + outputDirectory, e);
        }
    }

    private static String toJsonFileName(Path queryFile) {
        return queryFile.getFileName().toString().replaceFirst("\\.rq$", ".json");
    }

    private static void runQuery(Path queryFile, Path outputFile) {
        String queryText = readQueryFile(queryFile);

        Path temporaryFile = outputFile.resolveSibling(outputFile.getFileName() + ".tmp");
        try (QueryExecution queryExecution = createQueryExecution(queryText);
                OutputStream output = Files.newOutputStream(temporaryFile)) {
            ResultSetFormatter.outputAsJSON(output, queryExecution.execSelect());
            try {
                Files.move(temporaryFile, outputFile, StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temporaryFile, outputFile, StandardCopyOption.REPLACE_EXISTING);
            }
            System.out.println("JSON出力が完了しました: " + outputFile);
        } catch (IOException e) {
            try {
                Files.deleteIfExists(temporaryFile);
            } catch (IOException cleanupException) {
                e.addSuppressed(cleanupException);
            }
            throw new IllegalStateException("クエリ結果の出力に失敗しました: " + outputFile, e);
        }
    }

    private static String readQueryFile(Path queryFile) {
        try {
            return Files.readString(queryFile);
        } catch (IOException e) {
            throw new IllegalStateException("クエリファイルの読み込みに失敗しました: " + queryFile, e);
        }
    }

    private static QueryExecution createQueryExecution(String queryText) {
        return QueryExecutionHTTP.create()
                .endpoint(ENDPOINT_URL)
                .query(QueryFactory.create(queryText))
                .sendMode(QuerySendMode.asGetAlways)
                .param("timeout", TIMEOUT_MILLISECONDS)
                .httpHeader("User-Agent", USER_AGENT)
                .build();
    }

    /**
     * 実行対象となるクエリセットを表します。
     */
    private enum ExecutionMode {
        BASE_ONLY(false),
        INCLUDE_UPPER_CLASS(true);

        private final boolean includesUpperClassQueries;

        ExecutionMode(boolean includesUpperClassQueries) {
            this.includesUpperClassQueries = includesUpperClassQueries;
        }

        boolean includesUpperClassQueries() {
            return includesUpperClassQueries;
        }

        static ExecutionMode fromName(String name) {
            if (name.equalsIgnoreCase("base")) {
                return BASE_ONLY;
            }
            if (name.equalsIgnoreCase("all")) {
                return INCLUDE_UPPER_CLASS;
            }
            throw new IllegalArgumentException(
                    "MODEは base または all にしてください (base: 基本クエリのみ、all: 基本クエリと上位クラスクエリ)");
        }
    }
}
