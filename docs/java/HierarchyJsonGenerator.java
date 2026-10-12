import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 上位クラス、中間クラス、対象クラスの対応TSVを結合してコンソールに表示します。
 *
 * <p>入力ファイルはUTF-8、タブ区切り、各行は2列であることを前提とします。対応TSVは
 * 指定ディレクトリ直下に複数配置でき、すべて読み込みます。</p>
 */
public final class HierarchyJsonGenerator {
    /** KGIntegratorで事前に生成した統合TSV。 */
    private static final Path BASE = Path.of(".").toAbsolutePath().normalize();
    private static final Path INTEGRATED_TSV_FILE = BASE.resolve("output/kgtools-integrated.tsv");
    /** 階層データだけを書き出すJavaScriptファイル。 */
    private static final Path OUTPUT_JAVASCRIPT_FILE = BASE.resolve("app.js");
    private static final Path OUTPUT_JSON_FILE = BASE.resolve("output/hierarchy.json");

    private static final String INTEGRATED_HEADER =
            "上位クラスID\t上位クラスラベル\t中間クラスID\t中間クラスラベル\t対象クラスID\tラベル";

    private HierarchyJsonGenerator() {
        // 静的メソッドだけを持つユーティリティークラスのため、生成を禁止します。
    }

    /** 統合TSVを読み込み、ブラウザー用の階層データだけをJavaScriptへ出力します。 */
    public static void main(String[] args) throws IOException {
        List<String[]> integratedRows = readIntegratedRows(INTEGRATED_TSV_FILE);
        writeHierarchyJson(OUTPUT_JSON_FILE, integratedRows);
        writeJavaScript(OUTPUT_JAVASCRIPT_FILE, integratedRows);
        System.out.printf("%n%s に %d件の階層データを出力しました。%n",
                OUTPUT_JAVASCRIPT_FILE, integratedRows.size());
    }

    /** 統合TSVを、上位クラス→中間クラス→対象クラスのJSONへ変換します。 */
    private static void writeHierarchyJson(Path output, List<String[]> rows) throws IOException {
        StringBuilder json = new StringBuilder("[\n");
        String previousTop = null;
        String previousPath = null;
        for (String[] row : rows) {
            String topId = jsonValue(row[0]);
            String top = jsonValue(row[1]);
            String[] middleIds = row[2].split(" / ");
            String[] middleLabels = row[3].split(" / ");
            if (!top.equals(previousTop)) {
                if (previousTop != null) json.append("      ]\n    }\n  ]\n},\n");
                json.append("  {\"id\":").append(topId).append(",\"label\":").append(top)
                        .append(",\"children\":[\n");
                previousTop = row[1];
                previousPath = null;
            }
            String path = String.join(" / ", middleLabels);
            if (!path.equals(previousPath)) {
                if (previousPath != null) json.append("      ]\n    },\n");
                json.append("    {\"id\":").append(jsonValue(String.join(" / ", middleIds)))
                        .append(",\"label\":").append(jsonValue(path)).append(",\"children\":[],\"classes\":[\n");
                previousPath = path;
            }
            if (json.charAt(json.length() - 1) != '[') json.append(",\n");
            json.append("        {\"id\":").append(jsonValue(row[4])).append(",\"label\":")
                    .append(jsonValue(row[5])).append("}");
        }
        if (!rows.isEmpty()) json.append("\n      ]\n    }\n  ]\n}\n");
        json.append("]\n");
        Files.createDirectories(output.toAbsolutePath().getParent());
        Files.writeString(output, json.toString(), StandardCharsets.UTF_8);
    }

    private static String jsonValue(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r") + "\"";
    }

    /**
     * 結合済みのデータと画面描画処理を1つのJavaScriptファイルとして出力します。
     * HTML側はこのファイルを読み込むだけで、表・ツリー・検索フォームを表示できます。
     */
    private static void writeJavaScript(Path output, List<String[]> integratedRows) throws IOException {
        StringBuilder script = new StringBuilder("window.hierarchyRows = [\n");
        for (String[] row : integratedRows) {
            script.append("  {")
                    .append("topClassId: ").append(toJsonString(row[0])).append(", ")
                    .append("topClass: ").append(toJsonString(row[1])).append(", ")
                    .append("middleClassId: ").append(toJsonString(row[2])).append(", ")
                    .append("middleClass: ").append(toJsonString(row[3])).append(", ")
                    .append("id: ").append(toJsonString(row[4])).append(", ")
                    .append("label: ").append(toJsonString(row[5])).append("},\n");
        }
        script.append("];\n");
        Files.writeString(output, script.toString(), StandardCharsets.UTF_8);
    }

    /** 統合TSVを読み込み、現在の6列形式であることを検証します。 */
    private static List<String[]> readIntegratedRows(Path input) throws IOException {
        if (!Files.isRegularFile(input)) {
            throw new IOException("統合TSVが見つかりません: " + input);
        }
        List<String[]> rows = new ArrayList<>();
        try (BufferedReader reader = Files.newBufferedReader(input, StandardCharsets.UTF_8)) {
            String header = reader.readLine();
            if (!INTEGRATED_HEADER.equals(header)) {
                throw new IOException("統合TSVのヘッダーが不正です: " + input);
            }
            String line;
            int lineNumber = 1;
            while ((line = reader.readLine()) != null) {
                lineNumber++;
                if (line.isBlank()) continue;
                String[] columns = line.split("\\t", -1);
                if (columns.length != 6 || java.util.Arrays.stream(columns).anyMatch(String::isBlank)) {
                    throw new IOException("不正な統合TSV行です (" + input + ":" + lineNumber + ")");
                }
                rows.add(columns);
            }
        }
        return rows;
    }

    /** JavaScriptの文字列リテラルとして安全に埋め込めるJSON文字列へ変換します。 */
    private static String toJsonString(String value) {
        return "\"" + value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t") + "\"";
    }

}


